# UX wave · U10, second landing (U10b): the rest of the artifacts work, in four pull requests

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U10, second landing (**U10b**). **Parent pin:** master `93905c9effbda94ead21518439800f8bcbd72d24`, the commit every statement about the code below was checked against; the root, the child's file and the register are read at that commit.
>
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U10-artifacts.md`, cited below as *section*: its parts l6-artifacts-07 (b) and (c), O-43, l6-artifacts-08, l6-artifacts-15, l6-artifacts-18 and l8-settings-13, with the acceptance items A3 to A10, the Design inheritance, the checks under "Probes and checks" that are not marked done, and "Rulings reversed". This document carries the constraints, the milestones, the interfaces and what the section leaves open, and nothing else of the design. Where the code at the pin contradicts the section, "Where the section no longer holds" says so and gives the default built; the architect rules, and a ruling changes the one place each row names.
>
> **Branches:** this document is on `ux-wave/U10b`. Each of the four pull requests is built on a branch of its own from master, `ux-wave/U10b-1` to `ux-wave/U10b-4`, with this document merged in. **Board:** ticket 595, under epic 573. **Items:** l6-artifacts-07 (b), l6-artifacts-07 (c), l6-artifacts-18, O-43, l6-artifacts-08, l8-settings-13, l6-artifacts-15. **Not in this landing:** see "The landing's edge".

## Purpose

An agent that works on artifacts in MAWS still hands four chores to the person. It cannot make a memo fit one page, because the page a document prints on is chosen per export and nothing says how many pages came out. It retypes a whole HTML page to publish a new version, and can never get the page back as a file. It cannot remove a draft it abandoned. And it cannot be told how work in a Space should be done, or which design system the person picked for a new artifact.

On the person's side, the chat that floats over an artifact still carries a title row and a row of controls under the box, and cannot be put away; "Make something new" on the Library page is seven cards with thirteen buttons; and a design system's page draws its components at a fifth of their size.

After the four pull requests of this landing:

1. **The agent's documents and pages (U10b-1).** The agent sets a document's page (Letter or A4, compact density) with one op of the edit tool and reads from a PDF export how many pages it has. The person sees the same setting as checked items in the document's Export menu, and their own export uses it. The agent publishes an HTML page by naming the file it wrote, and exports the page back as the same bytes; the person has "Save a copy…" on an HTML artifact.
2. **A draft the agent can take back (U10b-2).** The agent deletes an artifact its own session made and no person wrote to. The transcript shows "Deleted <title>" with Undo; Undo brings it back, also on another machine's library.
3. **The chat over an artifact (U10b-3).** After Expand, only the composer's box floats at the lower right, with two small buttons. One opens the conversation; the other hides the chat, and the header of what it floated over then shows "Show chat".
4. **The Library (U10b-4).** "Make something new" is four cards that each start a chat, a More menu, and one design-system choice that the agent's `artifact_create` can honour. A Space carries instructions for agents, written from its menu, which reach an agent as a chip in the draft or in the artifact tools' answers. A design system's page shows its largest type sample whole and its components at twice today's size.

**How to see it working**, on the wave's build, in a session MAWS runs. Ask for a one-page memo: the agent's edit holds `set_page`, its PDF export answers `pages: 1`, and the document's Export menu shows "Compact" checked. Ask it to rebuild an HTML page: the publish call's input holds a path. Ask it to delete the draft it just made: the transcript reads "Deleted Draft" with Undo, and Undo puts the draft back in the Library. Open a document beside the chat and press Expand: only the box is left; press its Hide chat button and "Show chat" appears in the document's header. On the Library page, pick a design system in the heading of "Make something new" and click Document: a new chat opens with the opening words in its box.

## Progress

- [x] (2026-11-15) Document written against master `93905c9ef`: every "Today" statement of the seven items checked in the code, the two builds a trial can meet read at their commits (`2c7044231`, `f1852de3a`), the Claude Desktop citations of the section read again in `app-5.1231.2`. Twenty-eight places where the section no longer holds or leaves a choice open, each with the default built.
- [ ] The adversarial review of this document, and the architect's rulings on "Where the section no longer holds" and "For the architect's ruling".
- [ ] The drawn examples and the owner's cards ("The look"), before M3, M5, M7, M8, M9 and M11 are built.
- [ ] M1 — An HTML page is published from a file and exported as itself.
- [ ] M2 — A document's page is a setting of the document, and an export says how many pages it has.
- [ ] M3 — The person's Export menu shows the page, and the scenes of U10b-1.
- [ ] M4 — The agent deletes its own draft, and the delete can be undone.
- [ ] M5 — The transcript's row for a delete, its Undo, and the scenes of U10b-2.
- [ ] M6 — The float has three presentations.
- [ ] M7 — The bar and "Show chat" are drawn, and the scenes of U10b-3.
- [ ] M8 — "Make something new": four cards, More, and a design-system choice that binds.
- [ ] M9 — A Space carries instructions: the store, the sheet, the mark and the chip.
- [ ] M10 — The artifact tools give a Space's instructions.
- [ ] M11 — The design system's page, and the scenes and the record of U10b-4.
- [ ] Per pull request: the proofs an executor does not run ("Proof that an executor does not run").

## The cut: four pull requests

The landing is about 7,600 changed lines over about 165 files, in four areas that share almost no file. One pull request of that size cannot be read in one pass, and the four parts wait on different things: U10b-1 on the owner's look at a memo, U10b-3 on the look at the bar and best on U1b, U10b-4 on the look at the component cards. So it is four pull requests, each of which leaves master releasable and needs none of the others. Rejected: one pull request, which no reviewer reads in one pass; two (the tools, the window), which would tie the Library to the float and the delete's offer over the machine link to the page setting.

| pull request | branch | items | milestones | what the owner gets | what it stores or sends that is new | waits for |
|---|---|---|---|---|---|---|
| **U10b-1** | `ux-wave/U10b-1` | l6-artifacts-18, l6-artifacts-07 (b) | M1, M2, M3 | An agent can make a memo fit a page and say how many pages it is; the Export menu shows the page; an agent publishes an HTML page from its file; "Save a copy…" on an HTML artifact | one attribute in a document's content (`page`); no command, no wire minor | the owner's look at a memo at two densities, before it lands |
| **U10b-2** | `ux-wave/U10b-2` | l6-artifacts-07 (c) | M4, M5 | An agent removes its own abandoned draft; "Deleted <title>" with Undo in the transcript | one command (`artifacts.undelete`), one mark in the store's `meta`, one capability over the machine link; a wire minor and a link minor | nothing |
| **U10b-3** | `ux-wave/U10b-3` | O-43 | M6, M7 | Over an artifact the chat is the box alone and can be hidden; "Show chat" in the header | nothing | the owner's look at the bar; in either order with U1b ("Landings in flight") |
| **U10b-4** | `ux-wave/U10b-4` | l6-artifacts-08, l8-settings-13, l6-artifacts-15 | M8, M9, M10, M11 | Four cards and one design-system choice; a Space's instructions; component cards at a readable size | two commands, one key in the store's `meta`; a wire minor | the owner's look at the component cards on a Mac, before it lands |

Order: any. Recommended: U10b-1, U10b-2, U10b-4, then U10b-3 once U1b is on master. Two of them move `WIRE_MINOR`; whichever lands second takes the next number at its merge of master.

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
| **U1b** (requests drawn in the transcript) | `origin/ux-wave/U1b` | (1) Its line "Waiting for you · N" is drawn by `SessionPane` in its `compact` branch, above the composer, and calls `openCard` from `shell/floating.ts` (its decision 19). U10b-3 keeps mounting `SessionPane` with `compact` inside the bar and keeps `openCard`'s name and meaning, so the line shows in the bar with no edit on either side. (2) It removes the request's dock from the composer. Until it lands, a request that still waits while the chat is the bar is drawn docked in the bar's box, as the compact pane draws it today; A6's sentence about the one line is proven on the first master that holds both, by whichever lands second (its scene in `e2e/panel.spec.ts`). (3) It edits `transcript/model/derive.ts`, `rows.ts`, `schema.ts`, `copy.ts` and `serialize.ts`; M5 edits the same files at the `artifact` row only. (4) It edits `e2e/cross-build.spec.ts`; M3, M5 and M11 append scenes there. (5) It does not edit `shell/floating.ts` or `shell/FloatingPill.tsx` (its UC-8 table says none). | M7 and M5 |
| **U2b** (the to-human view) | `origin/ux-wave/U2b` | (1) It removes the `ReportBar` mount from `SessionPane.tsx` and mounts its switch in `Composer.tsx` directly after `PluginBand`; M7's lines in `Composer.tsx` are at the `Frame` call, the dictation notice and `PluginHint`, not there. (2) `isPersistentRow` keeps `artifact` rows in view through a fold, in MAWS's own folds and in the mirrored view, so the delete row stays where the owner learns of the delete. | M7 and M5 |
| **U6b-1** (a file opens beside the chat) | `origin/ux-wave/U6b` | (1) It adds one line to `TOOL_ERRORS` in `src/shared/maws/tools.ts` and a case in `tools.test.ts`; M1, M4 and M8 edit the same two files elsewhere. (2) It edits `panel/TabStrip.tsx`, `panel/host.ts` and `panel/SurfaceRow.tsx`, not `RegionControls` in `panel/PanelHeader.tsx`, where M7 inserts. (3) Whether a file's main tab has a header row is read at run time by M7's rule (`useEditorHostRegistration`), so a header it adds to a tab makes Hide chat offered there with no edit. | M7, M1, M4, M8 |
| **U6e** (outside files editable, Open File…) | `origin/ux-wave/U6e` | It edits the files service and `src/services/library/store.ts` and shares no file with this landing. M4's undelete announces `created`, which main's library sync already reads as a refresh. | M4 |
| **U11c** (Customize) | `origin/ux-wave/U11c` | A document only at this writing. Assumed to touch nothing under `library/`, `shell/`, `composer/frame/` or `src/artifacts/`. | M8 |
| any landing that moves `WIRE_MINOR` or `RL2_PROTOCOL.minor` | — | M4 and M9 each take the next free number at their merge, and regenerate `src/shared/ipc/wire-manifest.json`. | M4, M9 |

## Where the section no longer holds

Checked at the pin. "Default" is what this document builds unless the architect rules otherwise; "place" is the one place a different ruling changes. The first twelve change what the owner or an agent meets and are **for the architect's ruling**; the rest are corrections of fact.

| # | the section says | what the code holds | default built | place |
|---|---|---|---|---|
| H1 | Undo is "a call `artifacts.restore` beside today's `artifacts.delete`" | `artifacts.restore` exists and restores a *version* (`{artifactId, versionId}`, `src/shared/ipc/schema/artifacts.ts`; graded, offered over the link, in `ARTIFACT_OP_COMMANDS`, used by the history rail). Making `versionId` optional is a wire major by `src/shared/ipc/wire.ts`'s rule | a new command, `artifacts.undelete {artifactId}` | §C.2 |
| H2 | "A Space gains `instructions`" (the entity, the `spaces` table) | A fifth entry in `STORE_MIGRATIONS` makes both older builds open the artifact store read-only and refuse every write with `storeTooNew` (`openStore` in `src/engine-host/documents/migrations.ts`, identical at `2c7044231` and `f1852de3a`). `SpaceSchema` is a strict object, and `library.spaces` answers every Space, uncut, to any member who can list the machine | the text is held in the store's `meta` table under one key, read and written by two commands of its own that are not offered over the link; `SpaceSchema`, the table and `library.spaces` do not change | §E.1 |
| H3 | the agent may delete an artifact "that no person has written to" | Rows credited to the person exist that are not their edits: a design's migration at an open (`ensureMigrated(…, HUMAN)`), the rows a deck's editor writes when a text box is selected (the open half of l6-artifacts-09), and the clean-up an editor of an older build sends | an artifact with any content write credited to a person is refused, so a deck or a design the owner only opened can be refused with "the user has edited it". Safe side; one tracker row; it ends with the rest of l6-artifacts-09 | §C.1, rule 2 |
| H4 | Undo is "sent to that machine as the Library page's own acts are" | The route carries a new name only after six insertions (§C.3). And the endpoint cannot place a deleted artifact for a member who does not own the machine: `placeArtifact` reads the library entry, which is null once `deletedAt` is set, so the act would be refused `grade` | over the link the act is the machine's owners', as Fork is (`owners: true` on its row); a member who does not own the machine sees Undo disabled with "Only <machine>’s owners can restore an artifact there." | §C.3 |
| H5 | "annotated as destructive" | No `maws` tool carries `destructiveHint`; the annotation types admit `readOnlyHint` and `openWorldHint` only; the fixtures show the engine's permission request for read-only tools too, and nothing recorded shows what the engine does with the hint | the hint is added (`destructiveHint: true`); no code of MAWS depends on the engine reading it; a probe is offered, not required ("Proof", 9) | §C.1 |
| H6 | `set_page` is "atomic with the batch it is in" | `applyEdit` opens no transaction when a plan touches no block, so a batch of `set_page` alone would write nothing. And a batch that lands as suggestions (`mode: 'suggest'`, or the owner's "agent edits as suggestions") writes into the suggestion document, whose settings node nothing carries over at an accept | the plan gains the page, and a batch that sets only the page writes one row. A batch that would land as suggestions and holds `set_page` is refused whole, with a sentence | §B.2 |
| H7 | the export's page is "the size named in the `artifact_export` call; the document's; the design system's; Letter" | The document header's six rows each send a size, Markdown and Web page included, so the person's export never reaches the second step | the four format rows send no size; the three page items write the document's setting | §B.5 |
| H8 | "Not included: … page settings for other kinds" | A dashboard shares the document's header, edit tool, read tool, export source and exporters | `set_page` is refused for a dashboard, `page` is answered for a document only, and a dashboard's Export menu keeps today's six rows | §B.2, §B.5 |
| H9 | `artifact_export` accepts `html` for an HTML artifact, and the Export menus gain "Save a copy…" | `html` is already in `ARTIFACT_EXPORT_FORMATS`; the menus list whatever the registry serves for the kind, so registering the exporter also adds an "HTML" row beside "Save a copy…": two rows for the same bytes | the person's menus leave the `html` format out for an HTML artifact and show "Save a copy…", which also works against a machine of an older build | §A.3 |
| H10 | the design-system choice "applies to the kinds a design system governs (document, presentation, design)" | A dashboard is given the governing system's guide at its create (`documentCreateTool`) and is themed by it at export (`src/artifacts/dashboard/export.ts`); all four cards are therefore governed kinds | `designSystem` is accepted for document, presentation, design and dashboard, and the choice applies to all four cards | §D.1, `DESIGN_SYSTEM_KINDS` |
| H11 | in the bar "nothing under the box" | The composer draws a plugin's hint under its frame (`PluginHint`), which is a mod's drawing (law 2) | not drawn in the bar; the plugin's band above the frame is | §F.3 |
| H12 | "the float changing to another session's shows the card, as today" | For the float over a side surface the card is one card that follows the session in front (`floatIdentity` answers `'panel'`), and its closed state is kept when another session's tab comes in front | kept as the code has it: over a side surface a bar stays a bar and a hidden chat stays hidden when the session in front changes, and "Show chat" carries the new session's mark | §F.1 |
| H13 | "only an artifact that this session, or a session it was opened from, created (the lineage the handle lookup already uses)" | The lookup applies the lineage to a handle only; an id resolves for any session. The lineage is the side thread's ancestors (`artifactScopeOf`), not a fork's source, and is empty after an engine-host handover | `createdBy` is compared with `lineageOf(ctx, deps)`; an artifact another session made is refused with a third sentence | §C.1 |
| H14 | "Restored <title> with Open" | The row draws Open only for a registered HTML delivery (`deliverableId` and `version`) | the delete row's Open calls `actions.openArtifact` with the artifact's id for any kind | §C.4 |
| H15 | Undo is disabled with "<machine> is offline" | UC-7's one function words a disabled act "<Act> is unavailable while <machine> is offline." (`disabledWords` in `src/shared/ipc/remote-unavailable.ts`); only a refusal after the fact reads "Not <done>: <machine> is offline" | the function's words: "Restore is unavailable while <machine> is offline." | §C.3 |
| H16 | the path is "resolved and read as `artifact_create`'s is (against the session's working folder …)" | Create resolves a relative path against the working folder and takes an absolute path anywhere; it accepts `.htm` too; the steps are inline | one function serves both tools, with create's rule unchanged | §A.1 |
| H17 | `pages` is read "from the bytes `printToPDF` returns" | Those bytes exist only in the render process; the tool server names the exported file's path and already reads the file for `to` | the tool server counts the pages in the exported file. No schema between processes changes | §B.4 |
| H18 | a design system named "resolved as `space` is" | `spaceNamed` is the Space's; a design system has two names, the artifact's title and the law's title, which differ on a copy | the artifact's title, which is what the Library, the choice and the opening words show | §D.1 |
| H19 | "The draft's pasted-text chip keeps accepting a name of the caller's choosing (it does today)" | A prefill's `pasted[k].name` is dropped: `available` in `composer/editor/recall.ts` names every atom "Pasted text #n". Only a dropped text file keeps its name | `available` takes the prefill's name when one is given; one insertion in U4's file | §E.3 |
| H20 | "Needs from U4: the composer drawn as its bar alone (one property …)" | No such property exists; `ComposerProps` is `{appSessionId, paneIndex, client?}` and the `composer` slot passes the first two | a context read by `Composer`, and one prop of `Frame`; three insertions in U4's files | §F.3 |
| H21 | "the 76 px Display sample" | There is no Display role. The largest is `title`, whose deck sample is 76 to 112 px in the three bundled systems, drawn at half size | the rule is on every sample, as the section's After has it | M11 |
| H22 | "none of the three bundled systems has" a component the smaller canvas clips | True for width (the widest fixed width is 240 px). Height is not settled: a four-row table at the deck's type scale may pass 412 px | a scene measures every bundled component on the canvas; the canvas grows by the section's rule if one does not fit | M11, `COMPONENT_CANVAS` |
| H23 | "As today, the cards are disabled until the Space … is known" | Today only Ask Claude is disabled; New and Add a file… stay enabled and pass the Space's id | the card is disabled; Blank and Add a file… stay enabled | M8 |
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
5. **Stored and sent** (root UC-14's rule, applied to the artifact store). No entry is added to `STORE_MIGRATIONS` and `PRAGMA user_version` stays 4: a fifth entry would make both older builds open the store read-only. No field is added to `ArtifactSchema`, `SpaceSchema` or any other strict object that crosses a process or the link to a build that may be older; no member is added to any enum that crosses a process or the link (`artifacts.changed`'s `change`, `ARTIFACT_REFUSALS`, `spaces.changed`'s `change`). Neither settings file changes. §G states, per value, what each older build does with what this landing writes, and the reverse.
6. **Authorization is checked where the act runs, on the value the act uses.** The agent's delete evaluates its three rules inside the store's own batch that sets `deletedAt`, not in the tool before it. The undelete checks the agent's mark in the store method, whoever called. Over the link the endpoint decides on the command's own name; nothing in main or in `mawsd` turns another command into `artifacts.undelete`.
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
| A4, the row and Undo | the row; Undo calls `artifacts.undelete` here | the row is derived in this window from that machine's events; Undo is the offer of §C.3: an act on the `artifact` target, grade `manage`, the machine's owners only, behind the capability `rl2.artifact-undelete`. Drawn disabled, with `disabledWords`' sentence, while the machine is offline ("Restore is unavailable while <machine> is offline."), while its build does not list the capability ("Can’t restore on <machine> yet. Update MAWS on <machine> and try again."), and for a member who does not own it | no such call |
| A5, the tool (`path`, `html`) | yes | yes | no tools |
| A5, "Save a copy…" | `library.saveAs` from the stored file | the same command pages the stored file to this Mac (`saveRemote`), which a machine of either older build already serves | not tied to a session |
| A6 | the bar is `SessionPane`'s compact form, so it sends, queues and stops as the pane does | the same; while the machine is offline the pane draws its notice in the composer's place and the bar shows it, with its two buttons | the same; a terminal session that cannot be driven shows the holder's notice in the bar, with its two buttons |
| A7 | the cards are on this Mac's Library page; the chat they start is in a project of this Mac; `designSystem` on the tool works in any session MAWS runs | the section is not drawn while the page lists another machine's library (as today); the tool's `designSystem` resolves against that machine's systems | no tools |
| A8, the sheet and the mark | this Mac's Spaces | not drawn for a Space of another machine (the menu offers no management there today); nothing about a Space's instructions crosses the link | — |
| A8, the chip | in the draft of the chat a card starts | — (a card starts a chat on this Mac) | — |
| A8, the tools' answers | yes | yes, from that machine's store | no tools |
| A9 | held by tests | held by tests | — |
| A10 | a design system's page | the same page for a design system of another machine (it is a view) | — |

**What a caller on another machine can newly ask for: one thing.** `OFFERS` gains one row, `artifacts.undelete` (§C.3). Proof, by test in M4 and by `git diff origin/master...HEAD -- src/endpoint/offers.ts` in the pull request: no other row is added or changed in any of the four pull requests. `spaces.instructions` and `spaces.setInstructions` are not offered (`test/endpoint/artifact-rows.test.ts` pins them among the names that are refused), and `library.spaces`' answer is unchanged, so a Space's instructions never leave their machine. `artifacts.create` over the link already takes `designSystemId` in its orphan form, which only the machine's owners hold; nothing sends it from another machine in this landing. A document's `page` attribute travels in the document's content to whoever may open the document, as its text does.

**What the one new offer lets a caller do, and no more.** `artifacts.undelete` brings back only an artifact that an agent's `artifact_delete` removed and that nobody has restored since (the store's mark, checked in the store method), to the state it had; an artifact the machine's owner deleted in the Library is refused. The caller must be an owner of the machine. The tests it owes are in M4: a row test for each refusal the row can give (`not-offered` from a machine without the capability, where the device sends nothing; `owners-only`; `malformed` for an extra key; the store's refusal for an artifact with no mark), and the coverage tests that pin the table.

**Promotions.** A sweep of main, the services, `mawsd` and the endpoint for places where one received command is sent on as another (`invokeOwn`, `bus.invoke`, `dispatchLocal`, `dispatchToHost`, `link.act`, the endpoint's wrappers) found none on the artifact, library, Space and export paths that turns a window's or a remote caller's command into a privileged one. The one wrapper an undelete passes is `mawsd`'s `host.artifactOp`, which carries the name the endpoint already authorized, admits only the fixed set `ARTIFACT_OP_COMMANDS` and validates the input strictly again. M4 adds `artifacts.undelete` to that set and to no other wrapper, and its review lens reads the sweep again on the final diff.

## Plan of Work

Eleven milestones in four pull requests. Each stands on this document and the code, has its own proof and leaves the tree green. Interfaces are defined once, in "Interfaces and Dependencies" (§A to §I); a milestone points at them. M3, M5, M7, M8, M9 and M11 draw something new and do not start before the owner's answers on their frames are in ("The look").

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

**What exists at its end.** A document's settings node holds `page`. The agent sets it with `set_page`, in a batch with other ops or alone, and reads it in `artifact_read`. PDF, Word and web-page exports and the screenshot's export layout print on the size the call names, else the document's, else the system's, else Letter, and at compact density when the document says so. A PDF export's answer holds `pages`. The document guide tells the agent how to fit a page.

**What it touches.** `src/artifacts/document/meta.ts`; `src/shared/maws/document-tools.ts` (the op, the description, `DocumentReadResult`), `src/shared/maws/tools.ts` (the export result, two descriptions); `src/artifacts/document/edit-ops.ts`, `edit-plan.ts`, `patch-writer.ts`; `src/engine-host/tool-server/documents.ts`, `artifact-export.ts`; `src/artifacts/document/export/source.ts`, `design-system.ts`, `html.ts`, `docx.ts`; `src/artifacts/types/document/SKILL.md`; their tests; the probe snapshot.

**Interfaces.** Exposes §B.1 to §B.4. Consumes U10a's constructors and write path (its §A and §C).

**Decisions.**

1. The setting is one attribute of the settings node, set as one value, beside `dsOverrides` (§B.1). A version pins it because a version is the whole state; a restore brings the old setting back because the revert undoes map attributes too. Both are tested, not assumed.
2. `set_page` is an op of the plan (§B.2): the plan carries the page the batch leaves, `applyEdit` writes when the plan touches a block or sets the page, and the settings node is written inside the same transaction as the blocks. So a batch is one row whether or not it also changes text (U10a's constraint: one row per write), and a refused batch writes nothing. Rejected: writing the page in the tool's `writeAs` callback beside `reply`, which would leave the op out of the plan's all-or-none check.
3. `set_page` is refused for a dashboard, and refused, with the whole batch, when the batch would land as suggestions (H6, H8; §B.2's two sentences). A page is not something the person accepts passage by passage, and an agent whose edits the owner reviews should not change how the document prints unreviewed.
4. Compact is computed where every export binds the document's overrides, `exportDesign` (§B.4), from the governing system's resolved tokens, beneath the document's own overrides. Each number keeps its unit. With the three bundled systems and the house fallback the margin rule changes nothing (their margin is already 0.75 in); it matters for a system whose margin is larger. The three numbers are constants in one place and move on the owner's word (card 3).
5. `pages` is counted by the tool server in the exported file (§B.4), not sent from the render process (H17): no schema between processes changes, and an export made by a render host of an older build still gets a count. A count of zero is never answered; the field is left out.
6. `page` in the read answers the document's setting, with `system` and `standard` for what is not set (§B.3). The tool server does not resolve the system's tokens, so it cannot name the system's size; the agent's check is `pages`.

**What it does not touch.** The editor's view (it has no pages); the Export menu (M3); a design system's page tokens; Markdown export; a dashboard's exports beyond the gate of decision 3; `MawsArtifactExportAnswerSchema` and every other schema between processes.

**What it proves.** A3's agent half. Tests must also pin: a batch of `set_page` alone is one row credited to the agent and moves the revision once; `set_page` with a refused op in the same batch leaves the page as it was; a version made before a `set_page` reads the old page and a restore of it puts the old page back; `dsOverrides` survives a `set_page` and the reverse; a call's `pageSize` beats the document's; a document's override of a type size beats compact's value for that token; a `rem` token is scaled in `rem`; `artifact_screenshot` of a compact document draws compact; a reader's replica that receives a `set_page` sends nothing back (U10a's A2, for this write).

### M3 — The person's Export menu shows the page, and the scenes of U10b-1

**What exists at its end.** A document's Export menu is four formats (Markdown, Web page, Word, PDF), a separator, and three checked items: Letter, A4, Compact. An item writes the document's setting as a row of the person's; the format rows then export with it. The history card's menu is the four formats. A dashboard's menu is unchanged. The scenes of U10b-1 exist, the cross-build scene among them, and the record is written.

**What it touches.** `src/renderer/src/tools/document/header.ts`, `tab-state.ts`, `DocumentPanel.tsx`; `src/renderer/src/panel/editor-host.ts` and `PanelHeader.tsx` (U8's: §H); their tests (`header.test.ts`, `tab-state.test.ts`, `DocumentPanel.test.tsx`, `PanelHeader.test.tsx`); `e2e/document.spec.ts`, `e2e/artifacts-store.spec.ts`, `e2e/library.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-12-p3-b-documents.md`.

**Interfaces.** Consumes §B.1 and §B.4. Exposes §B.5.

**Decisions.**

1. The three items behave as §B.5 says: Letter and A4 show the size in force, and choosing the one that equals the system's page clears the document's size, so the document follows its system again; Compact is a toggle. Built as the default of card 2.
2. An item writes on the editor's own replica, in one transaction with an origin of the person's, as a tab's rename does; it is credited as that rename is. While the editor is read-only (a document opened to view, a shown version) the items show the setting and are disabled.
3. An export started after an item was chosen prints with it: `export` waits while the editor's replica holds a write the host has not acknowledged (§B.5). Without this, choosing Compact and then PDF could print standard.
4. The checked items are drawn by the header's menu for an entry that carries a checked state (§B.5); no other editor's menu changes.
5. `e2e/document.spec.ts`'s export scene (its line 297) is rewritten: where it picked "PDF, A4 (.pdf)" it chooses A4 and then PDF. A3's scene is new (Acceptance).

**What it does not touch.** The Library row menu's Export for a document (it sends no size and so already follows the document's setting after M2); a dashboard's header; decks' and designs' menus.

**What it proves.** A3's person half, and U10b-1's rows of §G by the cross-build scene. Tests must also pin: with nothing set and a system whose page is Letter, "Letter" is checked and nothing is written until an item is chosen; choosing "A4" writes one row of the person's and "A4" is then checked in a second window on the same document; opening the menu writes nothing; an item's write adds no paragraph to a document that ends in a chart (the write reaches the editor as the binding's transaction, which U10a's repairs do not answer).

**Pull request U10b-2 · a draft the agent can take back**

### M4 — The agent deletes its own draft, and the delete can be undone

**What exists at its end.** The tool `artifact_delete`, last in the list. The store's `deleteOwnDraft` and `undelete`. The command `artifacts.undelete`, served here and over the machine link by the machine's owners.

**What it touches.** `src/shared/maws/tools.ts`, `tools.test.ts`, the probe snapshot; a new `src/engine-host/tool-server/artifact-delete.ts`, `tool-server/tools.ts`, `server.test.ts`; `src/engine-host/documents/store.ts`, `storage.ts`, `register.ts` and tests; `src/shared/ipc/schema/artifacts.ts`, `names/artifacts.ts`, `grades/artifacts.ts`, `schema/host.ts`, `routes.json`, `wire.ts`, `wire-manifest.json`; `src/endpoint/offers.ts`, `capabilities.ts`, `src/shared/ipc/remote-unavailable.ts`, `apps/org-protocol/src/channel.ts` (U9's, by its rule for a later child's offer: §H); `src/main/lane-b/remote-artifacts.ts`; `test/endpoint/artifact-rows.test.ts`, `test/lane-b/offer-coverage.test.ts`, `src/engine-host/ops.test.ts`, `apps/org-protocol/test/messages.test.ts`, a new row test.

**Interfaces.** Exposes §C.1 to §C.3.

**Decisions.**

1. The three rules of the agent's delete (§C.1) are one store method and run inside the batch that sets `deletedAt`, on the row that batch reads (Constraint 6). The tool resolves the reference, calls the method with the lineage, and words the refusal.
2. "A person has written" is any content write credited to an actor that is not a session's: a row of `artifact_updates` for the artifact's own document, or a binding in `client_actors`, which outlives the log's seven-day pruning. Entity changes (a rename, a move, a pin) record no actor and are not counted. H3 states what this over-refuses and why it is the safe side.
3. The agent's delete leaves a mark in the store's `meta` table, and only an artifact with that mark can be undeleted (§C.1, §C.2). This is what bounds the offer over the link, and what keeps Undo from bringing back something the person deleted on purpose. The mark needs no migration, and both older builds read `meta` by key and never see it.
4. An undelete of an artifact that is already live answers success and changes nothing, so two presses, or two windows, end the same way. It announces `created` (H24): main's library sync refreshes on it, the endpoint's placement cache drops its entry on any change but `updated`, and the linked-folder mirror writes the files again.
5. A handle the deleted artifact held may have been taken by a newer artifact meanwhile. Both then hold it; the lookup already answers the newer one, and the restored one is reached by its id. Nothing is renamed.
6. Over the link the act is the machine's owners' (H4), behind a capability of its own, with `requires` read from `REMOTE_NEEDS` (U9's rule; `remote-artifacts.ts` hard-codes `rl2.artifacts` today, which would let an act held while offline go to a machine that does not know the command).
7. The tool is annotated `destructiveHint: true` (H5); the annotation types widen for it. It passes the session's permission mode like any `maws` tool: only `ask` is pre-allowed at launch.

**What it does not touch.** `ArtifactStore.delete` and the person's delete; `artifacts.restore` (the version restore); `artifacts.changed`'s schema; the endpoint's target rules (`src/endpoint/targets.ts`) and its placement read; connector grants (a delete removes them and an undelete does not bring them back, as the section says).

**What it proves.** A4's tool half and its route's authorization. Tests must also pin, each at the store's file (rows read after the commit): a draft made by the session is deleted and marked; one made by a side thread's parent is deleted from the side thread; one made by the person, one the person wrote to, and one another session made are each refused with their sentence and left live; a person's write that lands between the tool's lookup and the store's batch refuses the delete (the sequence held open); a design system still in use is refused as for the person; a replayed call answers the first answer and deletes nothing twice; undelete of a marked artifact clears `deletedAt` and the mark and announces `created`; undelete of an artifact deleted in the Library is refused and leaves it deleted; undelete of a live one is a success with no write; `PRAGMA user_version` is 4 after all of it.

### M5 — The transcript's row for a delete, its Undo, and the scenes of U10b-2

**What exists at its end.** An `artifact_delete` call draws the artifact row: "Deleting <title>…", then "Deleted <title>" with Undo, or "Could not delete <title>: <reason>". While the artifact is live again the row reads "Restored <title>" with Open. For a session on another machine Undo acts there, and is disabled with a sentence where it cannot work. The scenes of U10b-2 exist and the record is written.

**What it touches.** `src/renderer/src/transcript/model/classify.ts`, `derive.ts`, `rows.ts`, `schema.ts`, `copy.ts`, `serialize.ts`, `src/renderer/src/transcript/view/rows/Artifact.tsx`, `view/context.tsx` (per UC-3: §H) and their tests (`artifacts.test.ts`, `Artifact.test.tsx`, the snapshot suite); `src/renderer/src/library/actions.ts` and `App.tsx` (the action's registration); `e2e/maws-tools.spec.ts`, `e2e/deliverables.spec.ts`, `e2e/library.spec.ts`, `e2e/remote.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md`; `docs/tech-debt-tracker.md`.

**Interfaces.** Consumes §C.2, §C.3. Exposes §C.4.

**Decisions.**

1. What the row shows is read, not remembered: "Restored" while the library of the session's machine lists the artifact, "Deleted" while it does not (§C.4). So the row is right after a relaunch, in a second window, and after an Undo pressed elsewhere. Until the read has answered, the row reads "Deleted <title>" with no control.
2. Undo is disabled while its act is in flight. An act that ends without its effect leaves its sentence under the row and Undo enabled again: over the link the sentence is `refusalWords`' or `failureWords`'; here it is "Not restored: <the store's sentence>".
3. The row names the artifact by the tool's answer (`title`, `artifactId`); before the answer, by the reference the call gave. Its text in a copied transcript is the heading alone.
4. The row is an `artifact` row, so it stays in view when its turn folds (`isPersistentRow`), which is where the owner learns of the delete.

**What it does not touch.** The rows of create and publish and their Open; `openArtifactInPanel`; U6d's link element and click rule; the transcript's groups and folds.

**What it proves.** A4. Tests must also pin: the row of a session on another machine routes Undo to that machine by the session's address, also for an artifact the window has never listed; Undo held open shows the control disabled and a second press sends nothing; a link that drops while the act is in flight ends with the sentence and no change of state; the disabled sentences for offline, for a machine without the capability, and for a member who does not own it.

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

**What it does not touch.** `transfer.ts`; the layout store; the card's size and the column reservation; who counts as on screen.

**What it proves.** The transitions half of A6, by `floating.test.ts`: each row of §F.1's table is a case that asserts the next state and the focus mark; a request that arrives while hidden leaves the state and the focused element as they were; a request that arrives in the same tick as Hide chat is judged against the state that tick leaves (hidden: nothing opens); the header going away turns hidden into the bar.

### M7 — The bar and "Show chat" are drawn, and the scenes of U10b-3

**What exists at its end.** After Expand, or after the card's Close, the float is the composer's box alone, 420 px wide at the lower right, with Open conversation and, where a header exists, Hide chat at its right end. Hidden, the header of what the float sat over shows "Show chat" with the session's mark. The scenes of U10b-3 exist, and P4's Decision Log 83 is amended.

**What it touches.** `src/renderer/src/shell/FloatingPill.tsx`, `FloatingCard.tsx` and their tests (`FloatingPill.test.tsx`, `FloatingCard.test.tsx`, `SplitCard.test.tsx`); in U4's files, a new `src/renderer/src/composer/frame/bar.ts`, `Frame.tsx` and `Composer.tsx` with `Composer.test.tsx`; in U9's file, `src/renderer/src/main/Pane.tsx`; in U8's file, `src/renderer/src/panel/PanelHeader.tsx` with `PanelHeader.test.tsx` (§H); `e2e/panel.spec.ts`, `e2e/layout-transfer.spec.ts`; `docs/doperpowers/plans/2026-10-19-p4-smoothing.md`.

**Interfaces.** Consumes §F.1, §F.2. Exposes §F.3 and §F.4.

**Decisions.**

1. The bar mounts the session's pane in its compact form, as the pill does, inside a provider that tells the composer it is a bar (§F.3). So everything the pane draws in the composer's place or above it is in the bar with no code of its own: the holder's notice of a terminal session, the notice of an offline machine, the `/btw` card, the tab notes, U1b's waiting line, and a setup card (trust, a relay that is down, a start that failed), which takes the box's place as it does in a pane.
2. In the bar the composer's toolbar stays mounted and hidden, by the mechanism a docked card already uses (`DraftShownContext`), not unmounted. Its menus then close and stay closed, and the three chords that open them (the model, effort and mode menus) do nothing in the bar, as under a docked card; the conversation card has them. Dictation by its chord still works, and its notice moves above the frame as it does under a docked card. Rejected: unmounting the toolbar, which leaves a menu chord with no anchor and a mode menu marked open in the store.
3. The box carries the float's border and shadow; there is no section frame, no title row and nothing under the box, the plugin's hint included (H11). What the composer draws above the box stands on one raised surface that reaches down to the box, and only while something is there (the default of card 1).
4. The two buttons are icon buttons at the right end of the box's row, outside the box, bottom-aligned with it: Open conversation (its tooltip the session's title; it carries the session's mark, the glyph the sidebar's row draws) and Hide chat. After the card's Close the keyboard is on Open conversation; after Expand and after Show chat it is in the box's editor.
5. "Show chat" is a labelled button with the session's mark. In the main area it stands in the artifact's header directly before Restore split (`TabHeader` in `main/Pane.tsx`); over a side surface, in the side column's controls directly before the float control (`RegionControls`). After Hide chat it has the keyboard.
6. Over a main tab whose body registers no header (a file, a diff, another session) the bar has Open conversation only. Over a Browser page the chip in the page's tab row stays as it is (the section's "Not included").
7. The inline chip's accessible name ("Show session card") is kept, since the Browser's scenes read it; the bar's region is renamed from "Compact session composer" to "Chat", and the two scene files that read the old name change with it.

**What it does not touch.** `session/SessionPane.tsx` (no edit is needed: H27); `shell/transfer.ts`; the card and its header; the Browser's chip; the deck stage's reserve; any stored layout.

**What it proves.** A6. Tests must also pin: the bar has no element with the toolbar's role in the accessibility tree and no title button; attached files and a waiting message draw above the box in the bar; a comment sent to the main session while the chat is hidden is delivered and opens nothing (UC-5); ⇧⌘\ from the artifact opens a bar or a hidden chat as the card with the keyboard in its composer; ⌥⌘B over a side surface does the same; "Show chat" is absent while the chat is a bar or a card.

**Pull request U10b-4 · the Library**

### M8 — "Make something new": four cards, More, and a design-system choice that binds

**What exists at its end.** `artifact_create` takes `designSystem`. On the Library page the section is four cards (Document, Presentation, Dashboard, Design), each one button that starts a chat with the opening words, with a "Blank" link; a More menu (Design system, HTML page, Add a file…); and one design-system choice in the heading.

**What it touches.** `src/shared/maws/tools.ts`, `tools.test.ts`, the probe snapshot; `src/engine-host/tool-server/artifact-tools.ts`, `documents.ts` (the document and dashboard create) and tests; `src/renderer/src/library/MakeSomethingNew.tsx`, `copy.ts`, `Library.test.tsx`, `LibraryMachineMenu.test.tsx`.

**Interfaces.** Exposes §D.

**Decisions.**

1. `designSystem` resolves a design system by id, then by the artifact's title exactly, then ignoring case and spaces, among live design systems (H18); two matches are refused naming their ids, none is refused naming the systems that exist. The new artifact carries it as its own system and the answer's guide is that system's. A create without it sets none, as today (the test "sets no designSystemId" stays).
2. The kinds that take it are document, presentation, design and dashboard, one constant (H10).
3. The choice is state of the section's component: it holds while the page is open and is gone when the page closes, which is the section's "not stored". The default shown is what `useDocumentGoverningSystem({ spaceId })` answers for the Space the page is narrowed to.
4. Blank passes `designSystemId` only when the chosen system is not the default, so an artifact made under the default keeps following the defaults.
5. The opening words are §D.2's, exact. A card press awaits the session's creation (and, for a Space with a linked folder, the folder's project first): the card is disabled meanwhile so a second press starts no second chat; a failure is the toast it is today; if the person has moved to another tab meanwhile the new chat opens behind, by `createSession`'s existing rule.

**What it does not touch.** The page itself and how it is left (`stores/layout.ts`); the Library's lists; another machine's library, where the section stays undrawn; a Space's default system.

**What it proves.** A7. Tests must also pin: the opening words for each of the four kinds, with and without a Space, with and without a chosen system; "Blank" on a card with a chosen system calls `artifacts.create` with its id, and with the default calls it with none; `designSystem` on an HTML page or a file is refused; the More menu's three entries.

### M9 — A Space carries instructions: the store, the sheet, the mark and the chip

**What exists at its end.** A Space's menu has "Instructions…", which opens a sheet with one field; a Space that has instructions shows a mark on its heading line. A chat started from a card with the page narrowed to such a Space carries the instructions as one chip after the opening words.

**What it touches.** `src/engine-host/documents/store.ts`, `register.ts`, tests; `src/shared/ipc/schema/spaces.ts`, `names/spaces.ts`, the grades and routes tables, `wire.ts`, `wire-manifest.json`; `test/endpoint/artifact-rows.test.ts` (the names that stay refused); `src/renderer/src/library/SpaceDialogs.tsx`, `dialogs.ts`, `Library.tsx`, `Rows.tsx`, `actions.ts`, `store.ts`, `copy.ts`, `MakeSomethingNew.tsx` and tests; in U4's file, `src/renderer/src/composer/editor/recall.ts` with its test (§H).

**Interfaces.** Consumes §D.2. Exposes §E.1 to §E.3.

**Decisions.**

1. The text is held in the store's `meta` table, not in a column and not in the entity (H2; Constraint 5). Two commands read and write it; neither is offered over the link.
2. A write announces through the existing `spaces.changed` with `change: 'updated'`, whose payload does not change. Deleting a Space removes its text; a text whose Space no longer exists (a Space deleted under an older build) is dropped at the next write.
3. The sheet is the library's sheet pattern with a multi-line field: Enter makes a new line and Save is a button. Saving awaits the command: the buttons are disabled meanwhile, a failure shows its sentence in the sheet and keeps the text, and closing the sheet while a save is in flight does not cancel the save.
4. The chip is the composer's pasted-text atom, placed by the prefill after the opening words, named `Instructions for “<name>”`. The prefill's name is kept (H19). Its body opens with the section's line, then the text.
5. The mark and the menu item are drawn where Space management is drawn today: for a Space of this Mac.

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

**What it proves.** A8's third sentence. Tests must also pin, through the session's real tool server: create in a Space, then read in the same Space, gives the instructions once; a change of the text gives them again at the next answer; the fixture's compaction frame fed to the session gives them again; two Spaces are tracked apart; a Space with no text adds no field; a linked read neither carries nor marks.

### M11 — The design system's page, and the scenes and the record of U10b-4

**What exists at its end.** On a design system's page a type sample breaks inside a word that does not fit its cell, and each component is drawn on a 960 × 540 canvas with a 64 px inset, at twice today's size in the same card. Layouts keep the slide canvas. The scenes of U10b-4 exist, and the record is written.

**What it touches.** `src/artifacts/design-system/page/page.css`, `page/Canon.tsx`, `DesignSystemPage.test.tsx`; `e2e/design-systems.spec.ts`, `e2e/library.spec.ts`, `e2e/cross-build.spec.ts`; `docs/charter.md`, `docs/doperpowers/plans/2026-10-12-p3-l-library.md`, the P3 interface ledger's X23 entry, `docs/tech-debt-tracker.md`.

**Interfaces.** None exposed.

**Decisions.**

1. `overflow-wrap: anywhere` goes on the sample's text inside `.dsp-specimen`, on every role; the system's own `word-break` still decides wherever the word fits. If the scene shows that the app's Chromium does not break a Korean word under `keep-all` with it, the cell scrolls sideways instead (the section's fallback), and that is one declaration.
2. The component canvas is one constant, `COMPONENT_CANVAS`, with the inset derived from it (a fifteenth of the width); `SlideFrame` takes its canvas as a property. A scene loads each bundled component's frame document outside the sandbox at the canvas size and reads whether its content overflows (H22). If one does, the constant grows to the next of 1120 × 630 and 1280 × 720 at which none does, and the scene's expectation names the size reached.
3. The frames' sandbox and content policy do not change.

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
   | M5 | `src/renderer/src/transcript src/renderer/src/library src/renderer/src/lane-b test/support/tokens-guard.test.ts` |
   | M6 | `src/renderer/src/shell` |
   | M7 | `src/renderer/src/shell src/renderer/src/composer src/renderer/src/main src/renderer/src/panel src/renderer/src/session src/renderer/src/side src/renderer/src/app test/support/tokens-guard.test.ts` |
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

With `density`, the design resolves over `{ ...compactOf(system), ...overrides }`: each `--ds-type-<role>-size` of the eight roles times `COMPACT.type`, each `--ds-space-<n>` times `COMPACT.space`, each in its own unit and rounded to two decimals, and `--ds-page-margin` set to `COMPACT.margin` when the system's is larger. `html.ts` and `docx.ts` pass `source.page.density`. `ArtifactExportResultSchema` gains `pages: z.number().int().positive().optional()`, answered for `format: 'pdf'` from the exported file by a counter in the tool server:

    // The number of page objects in a PDF as Chromium writes it; null when none is found.
    export function countPdfPages(bytes: Uint8Array): number | null;   // counts /\/Type\s*\/Page(?![s\w])/g, the count e2e/document.spec.ts asserts today

`artifact_export`'s description gains, after "Returns the exported file's path;": ` a pdf's answer also names pages, its page count;`. The document guide (`src/artifacts/types/document/SKILL.md`) gains, after the sentence that fonts, colours, spacing and page size come from the system: `To fit a page, set the document's page with \`set_page\` and check the PDF's \`pages\`.`

**§B.5** The person's menu. `documentExports` in `src/renderer/src/tools/document/header.ts` answers, for a document: four format rows with no size ("Markdown (.md)", "Web page (.html)", "Word (.docx)", "PDF (.pdf)"), then three page items, "Letter", "A4", "Compact"; for a dashboard, today's six rows. `EditorHostExport` (`src/renderer/src/panel/editor-host.ts`) gains an optional `checked?: boolean`; an entry that has it is drawn by `ExportEntries` (`panel/PanelHeader.tsx`) as a checkbox item, after a separator. The rule: "Letter" or "A4" is checked when it is the size in force (the document's, else the system's page when that is one of the two); choosing an unchecked one writes it, except that choosing the one that equals the system's page removes the document's size; choosing the checked one does nothing. "Compact" is checked when the density is compact; choosing it toggles. `DocumentTabState.export` sends a size only where the row carries one (a dashboard's rows) and, before it asks for the export, waits while the editor's provider reports writes the host has not acknowledged (`unsaved` in the provider's state) and is connected.

### §C. The agent's delete and its undo (M4, M5)

**§C.1** The tool, last in `MAWS_TOOL_NAMES` and last in `mawsTools`' array (the order `tools/list` answers):

    artifact_delete { artifact: <id or handle> }  →  { status: 'deleted', artifactId, kind, title }
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    title: 'Delete artifact'
    description: "Delete a MAWS artifact this session made and no longer needs, such as an abandoned draft; without this tool, ask the user to delete it in the Library. Only an artifact that this session, or the session a side thread was opened from, created and that the user has not written to; anything else is refused with the reason. The user can undo it from the transcript. Returns the deleted artifact's id, kind and title."

In `ArtifactStore`:

    // The agent's delete of its own draft. The rules run in the batch that sets deletedAt, in this order; the first that fails refuses.
    deleteOwnDraft(artifactId: string, lineage: readonly AppSessionId[], inFrame?: InFrame<void>): Promise<void>;

1. `createdBy` is a session of `lineage`. Otherwise `TOOL_ERRORS.deleteByUser` when a person created it, `deleteOtherSession` when another session did.
2. No content write is credited to an actor that is not a session's: no such row in `artifact_updates` for the artifact's own document, and no such binding in `client_actors`. Otherwise `deleteEdited`.
3. A design system that is another live artifact's own system is refused as `delete` refuses it (`designSystemInUse`).

Then it does what `delete` does and writes the mark `agentDeleted:<artifactId>` in `meta` (its value the time and the deleting session). The refusals, word for word:

    deleteByUser: (title: string) => `artifact_delete: "${title}" was created by the user; ask them to delete it in the Library`,
    deleteEdited: (title: string) => `artifact_delete: the user has edited "${title}"; ask them to delete it in the Library`,
    deleteOtherSession: (title: string) => `artifact_delete: "${title}" was created by another session; ask the user to delete it in the Library`,

**§C.2** The command, engine-host owned, grade `manage`:

    'artifacts.undelete': host(z.strictObject({ artifactId: Id }), z.void())

`ArtifactStore.undelete(artifactId)`: a live artifact, success and no write; a deleted artifact with the mark, `deletedAt` cleared, `updatedAt` set, the mark removed, `created` announced; a deleted artifact with no mark, refused with the existing reason `invalid` and the sentence "this artifact was deleted in the Library, not by an agent"; an unknown id, `notFound`.

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

**§C.4** The row. `rows.ts`: the `artifact` row's `action` becomes `'create' | 'update' | 'delete'`. `classify.ts`: `artifact_delete` presents as `'artifact'`. The row of a delete takes `title` and `artifactId` from the tool's answer once it is in. `copy.ts`, in `ARTIFACT`:

    deleting: (title: string) => `Deleting ${title}…`, deleted: (title: string) => `Deleted ${title}`, restored: (title: string) => `Restored ${title}`,
    couldNotDelete: (title: string, reason: string) => `Could not delete ${title}: ${reason}`, undo: 'Undo', notRestored: (sentence: string) => `Not restored: ${sentence}`

`TranscriptActions` (`transcript/view/context.tsx`) gains:

    // UX wave U10b: undo an agent's delete on the session's machine. Resolves null when the artifact is live again, else the sentence to show.
    undeleteArtifact?(appSessionId: AppSessionId, artifactId: string): Promise<string | null>;

implemented in `library/actions.ts` and registered in `App.tsx` beside `openArtifact`. It records the artifact's machine as `openArtifactInPanel` does (`sessionArtifactMachine`, `recordArtifactMachine`) and invokes `artifacts.undelete` there. The row view reads whether the artifact is live from `useLibraryRow(artifactId)` after the same record, and whether Undo can work from `useRemoteUnavailable(appSessionId, 'artifacts.undelete')`.

### §D. "Make something new" and the design-system choice (M8)

**§D.1** `ArtifactCreateInputSchema` gains `designSystem: z.string().min(1).max(200).optional()`. In `src/shared/maws/tools.ts`: `export const DESIGN_SYSTEM_KINDS = ['document', 'presentation', 'design', 'dashboard'] as const`. In the tool server, beside `spaceNamed`: `designSystemNamed(store, ref)`, with the refusals

    noDesignSystem: (ref: string, names: readonly string[]) => `artifact_create: no design system "${ref}"; the design systems are: ${names.join(', ')}`,
    designSystemAmbiguous: (ref: string, ids: readonly string[]) => `artifact_create: more than one design system is named "${ref}"; give one of these ids: ${ids.join(', ')}`,
    designSystemNotForKind: (kind: string) => `artifact_create: a ${kind} takes no design system`,

`artifact_create`'s description gains, after the sentence on `space`: ` Give designSystem (a design system's id or its name) to bind a document, presentation, design or dashboard to that system in place of the default; one that does not exist is refused.` (The description's length pinned in `tools.test.ts` moves with it.)

**§D.2** In `src/renderer/src/library/copy.ts`:

    export function askClaudePrefill(kind: ArtifactKind, spaceName?: string, systemName?: string): string;
    // `Make a document: ` · `Make a document in the Space “Work”: ` · `Make a document, in the design system “Classroom”: ` · `Make a document in the Space “Work”, in the design system “Classroom”: `

with today's article ("an" for an HTML page) and today's nouns. `systemName` is given only for a kind of `DESIGN_SYSTEM_KINDS` and a chosen system that is not the default. The section's labels: the cards "Document", "Presentation", "Dashboard", "Design"; the link "Blank"; the menu "More" with "Design system" (its two entries "Ask Claude" and "Blank"), "HTML page" and "Add a file…"; the choice's default entry `<name> · default`.

### §E. A Space's instructions (M9, M10)

**§E.1** The store. One key of `meta`, `spaceInstructions`, whose value is the JSON of `{ [spaceId]: { text: string; at: number } }`. `export const SPACE_INSTRUCTIONS_MAX = 8000` (characters), beside `SpaceSchema`'s file but not in it. Commands, engine-host owned, in `src/shared/ipc/schema/spaces.ts`, not in `OFFERS`:

    'spaces.instructions': host(z.strictObject({}), z.strictObject({ instructions: z.array(z.strictObject({ spaceId: z.uuid(), text: z.string(), at: z.number().int().nonnegative() })) }))
    'spaces.setInstructions': host(z.strictObject({ spaceId: z.uuid(), text: z.string().max(SPACE_INSTRUCTIONS_MAX) }), z.void())   // '' removes

A write announces `spaces.changed { spaceId, change: 'updated' }`. `ArtifactStore.spaceInstructions(spaceId): { text: string; at: number } | null` is what the tool server reads.

**§E.2** The renderer. `useSpaceInstructions(): ReadonlyMap<string, string>` in `library/store.ts`, read on this Mac and refreshed on `spaces.changed`; `setSpaceInstructions(spaceId, text)` in `library/actions.ts`. Copy, in `SPACE_COPY`: the menu item "Instructions…"; the sheet's title `Instructions for ${name}`; its line "Agents read these when they make or open an artifact in this Space."; its buttons "Cancel" and "Save"; the mark "Instructions".

**§E.3** The chip. `Prefill.pasted[k].name` is honoured: `available` in `composer/editor/recall.ts` names the atom by the prefill's name when it is given, else "Pasted text #n" as today. The card's prefill is the opening words followed by one pasted placeholder, with

    pasted: [{ name: `Instructions for “${space.name}”`, text: `Instructions of the Space “${space.name}”, set by the user in MAWS:\n${text}` }]

**§E.4** The tools. `ArtifactCreateResultSchema`, `ArtifactReadResultSchema`, `DocumentReadResult` and `ArtifactDescribeTypeResultSchema` gain `spaceInstructions?: { spaceId: string; name: string; text: string }`. `ArtifactDescribeTypeInputSchema` gains `space: z.string().min(1).max(200).optional()`, resolved by `spaceNamed`; with it and no `artifact`, the answer's `home` and design system are that Space's. `ArtifactSession` (`artifact-context.ts`) gains `instructed: Map<string, number>` (per Space, the `at` of the text given) and `forgetInstructed()`, which `SessionMaws.observe` calls on a `boundary.compaction` event. Description sentences: `artifact_describe_type`, after "without artifact this describes the default for a new artifact": ` Pass space (a Space's id or its name) to describe a new artifact in that Space.`; and at the end of `artifact_create`'s, `artifact_read`'s and `artifact_describe_type`'s: ` When the artifact's Space has instructions from the user, the answer carries them as spaceInstructions, the first time and again after they change: follow them for work in that Space.`

### §F. The chat over an artifact (M6, M7)

**§F.1** `useFloatingCard` (`src/renderer/src/shell/floating.ts`) gains `hidden: boolean` (meaningful only while `closed`) and `showChatTakesFocus: boolean`; `setClosed(false)`, and every reset of `closed`, clear `hidden`. New exports:

    export type ChatPresentation = 'card' | 'bar' | 'hidden';
    export const chatPresentation = (state: Pick<FloatingCardState, 'closed' | 'hidden'>): ChatPresentation;
    export function hideChat(): void;            // bar → hidden; "Show chat" takes the keyboard
    export function showChat(): void;            // hidden → bar; the bar's editor takes the keyboard (markFocusOnMount)
    export function showChatHeaderGone(): void;  // hidden → bar, the keyboard left where it is; a no-op in any other state

`openCard`, `closeCard`, `expandPane`, `focusSplitCard`, `togglePanelFloat` and `dockCard` keep their names. The table, which is the section's with the two rows this document adds (the last two):

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
| bar or hidden, over a side surface | another session's tab comes in front | the same presentation, for that session | where it was |

**§F.2** Where Hide chat is offered: one hook in `src/renderer/src/shell/`, `useShowChatHeader(): boolean`, true for the panel's float always (the side column's controls are drawn), and for the split's float while the tab in front of the other pane registers a header (`useEditorHostRegistration` for its scope). The bar draws Hide chat only while it is true, and the float's layer calls `showChatHeaderGone` when it turns false.

**§F.3** The composer as a bar, in U4's folder. New `src/renderer/src/composer/frame/bar.ts`:

    export const ComposerBarContext = createContext(false);   // true inside the float's bar

`Composer` reads it and passes `bar` to `Frame`; `FrameProps` gains `bar?: boolean`. In a bar: the toolbar is mounted and hidden and `DraftShownContext` is false for it; the box takes the float's border and shadow; the dictation notice is drawn above the frame, as when a card is docked; the plugin's hint under the frame is not drawn.

**§F.4** Names the scenes and tests read: the bar's region `aria-label="Chat"`, with `data-pane="card"` and `data-compact-session` kept; the buttons' accessible names "Open conversation", "Hide chat", "Show chat"; `data-chat-presentation="bar"` on the region.

### §G. What this landing stores and sends, and what each older build does with it

"2c" is `2c7044231`, "F" is `f1852de3a`. "Read" means read in that build's source at that commit; "scene" is the cross-build scene that asserts it. Nothing in the layout or in either settings file changes in any of the four pull requests.

| value | pull request | what 2c and F do with what this build writes | what this build does with theirs | this build, then one of them, then this build | proof |
|---|---|---|---|---|---|
| `page` on a document's settings node | U10b-1 | Read: every reader of the node asks for `dsOverrides` only, and `setDsOverrides` replaces that attribute alone, so `page` is ignored and kept. Their exports print on the export's size or the system's, at standard density; their Export menu shows the six rows. An accepted suggestion there walks every root's attributes when it pairs units: not read to the end, so the scene accepts one | a document without `page` is the system's page at standard density | the setting is still there and still in force; a version made there pins it as any content | scene "(document page, both ways)" |
| `artifact_edit`'s op `set_page` | U10b-1 | their tool servers refuse the op as invalid arguments; their agents are never told of it (the tool list is that build's) | — | — | read |
| `pages` in the export tool's answer | U10b-1 | not sent between processes: counted by this build's tool server in the file a render host of any build wrote | — | — | unit |
| the mark `agentDeleted:<id>` in `meta`, and a cleared `deletedAt` | U10b-2 | Read: `meta` is read by key only (`storage.ts`), so the mark is never seen. A deleted artifact is deleted there too; one this build undeleted is live there. `user_version` stays 4, so their stores stay writable | an artifact they deleted has no mark and cannot be undeleted | an agent's delete made here is still undoable after a stay on either | scene "(deleted draft, both ways)" |
| the command `artifacts.undelete` | U10b-2 | as a machine: its endpoint answers `not-offered`, and this build's device sends nothing because the handshake lacks `rl2.artifact-undelete`; Undo is drawn disabled with "Can’t restore on <machine> yet…" | as a window of theirs on this build's machine: it never sends the command, and it draws an `artifact_delete` call as an ordinary tool call | — | device test; scene's gap check |
| the tool `artifact_delete` in a transcript | U10b-2 | they draw the call as a tool call of a server they know, with no row of its own | a transcript they recorded holds no such call | — | read |
| the key `spaceInstructions` in `meta` | U10b-4 | never read. A Space renamed there keeps its text; a Space deleted there leaves an entry that this build drops at its next write | no key: no Space has instructions | the text is there for every Space that still exists | scene "(space instructions, both ways)" |
| the commands `spaces.instructions`, `spaces.setInstructions` | U10b-4 | an engine host of theirs answers `unknown_command`; the window then shows no mark, and the sheet's Save fails with its sentence | — | — | unit; scene's gap check |
| a stored draft whose chip carries a name | U10b-4 | Read: a pasted atom's `name` is any string in both (a dropped text file already stores one); their composer opens the draft with the chip named as stored | — | — | scene, in "(space instructions, both ways)" |
| `designSystem` on `artifact_create`; `space` on `artifact_describe_type`; `path` on `artifact_publish` | U10b-4, U10b-1 | tool inputs, validated by the tool server of the build that listed them; nothing crosses builds | — | — | read |

**Wire.** U10b-2 and U10b-4 each add engine-host commands and so each move `WIRE_MINOR` by one (`src/shared/ipc/wire.ts`: a new command is additive); U10b-2 also moves `RL2_PROTOCOL.minor` by one for its capability. U10b-1 and U10b-3 add no command, no event and no property to any schema between processes, and move neither. No minor is taken for the gate's sake.

**The cross-build scenes** go in `e2e/cross-build.spec.ts` beside the existing stored-form scenes (the pattern is "(sidebar, both ways)"): each reads the stored form both ways first, skips only on a fact read from the peer's own source, and never skips on `sameWire`, so it runs when the two builds speak one wire. Each adds its row to the coverage table in that spec's header comment ("UC-14's coverage"), which has no artifact-store row today. Every one of the three asserts that the peer's `artifacts.status` is `ok`, not `readOnly`, after this build wrote: that is the proof that no migration was added.

### §H. Files other children own, and files several landings edit (root UC-8)

| file | owner | the insertion | milestone |
|---|---|---|---|
| `src/renderer/src/composer/frame/bar.ts` (new), `frame/Frame.tsx`, `Composer.tsx` | U4 | §F.3: the context, one prop, three conditions | M7 |
| `src/renderer/src/composer/editor/recall.ts` | U4 | §E.3: a prefill's pasted name is kept | M9 |
| `src/renderer/src/main/Pane.tsx` | U9 | "Show chat" in `TabHeader`'s controls, before Restore split | M7 |
| `src/renderer/src/panel/PanelHeader.tsx` | U8 | "Show chat" in `RegionControls`, before the float control (M7); a checkbox entry in `ExportEntries` (M3) | M7, M3 |
| `src/renderer/src/panel/editor-host.ts` | U8 | `checked?` on `EditorHostExport` | M3 |
| `src/renderer/src/transcript/model/classify.ts`, `derive.ts`, `rows.ts`, `schema.ts`, `copy.ts`, `serialize.ts`, `transcript/view/rows/Artifact.tsx`, `view/context.tsx` | per UC-3 | the `artifact` row's third action, §C.4 | M5 |
| `src/shared/maws/tools.ts`, `document-tools.ts` | per UC-15 | §A to §E's tool texts and schemas | M1, M2, M4, M8, M10 |
| `src/endpoint/offers.ts`, `capabilities.ts`, `src/shared/ipc/remote-unavailable.ts` | U9 | §C.3, by U9's own rule; U9 reviews | M4 |
| `apps/org-protocol/src/channel.ts`, `src/shared/ipc/wire.ts`, `wire-manifest.json`, `schema/host.ts`, the names, grades and routes tables | no child | the minors, the generated manifest, the registries' rows | M4, M9 |
| `src/main/lane-b/remote-artifacts.ts` | no child | §C.3's two lines | M4 |
| `src/render/export.ts`, `src/renderer/src/tools/document/`, `src/renderer/src/tools/artifacts/viewers/ByteViewer.tsx` | no child (the comment binding in `tools/document/comments.tsx` is U5's and is not edited) | §A.3, §B.5 | M1, M3 |
| `e2e/cross-build.spec.ts` | shared by the landings | three scenes and three rows of the coverage table | M3, M5, M11 |
| `src/renderer/src/session/SessionPane.tsx` | U1 | none | — |

U5a's insertions in U10's files (`reply` in `document-tools.ts` and `edit-plan.ts`, the pass in `tool-server/documents.ts`, the count rule, the flash, the guide's one clause) are on master; M2 edits `document-tools.ts`, `edit-plan.ts`, `documents.ts` and the document guide beside them and changes none of them.

### §I. Acts that await, and the test that holds each open

| act | awaits | the person acts meanwhile | it fails or never comes | test |
|---|---|---|---|---|
| publish from `path` | the file's read | — (a tool call) | refused before any write | M1 |
| the agent's delete | the store's batch | a person's write lands first: the delete is refused | the store's refusal, worded | M4, the sequence held open |
| export after a page item | the host's acknowledgement of the write, then the export | a second export is ignored while one runs, as today | a host that is gone: the export fails with its own error, as today | M3 |
| the tool's `pages` | the exported file's read | — | the field is left out | M2 |
| Undo | `artifacts.undelete` here or over the link | Undo is disabled; a second press sends nothing | the sentence under the row; Undo enabled again; a link that drops mid-act ends with "Not restored: <machine> is offline" | M5 |
| the row's live state | the library's read | no control is drawn until it answers | an offline machine: "Deleted <title>" with Undo disabled and its sentence | M5 |
| a card of "Make something new" | the linked folder's project, then the session's creation | the card is disabled; moving to another tab opens the chat behind | today's toast | M8 |
| the sheet's Save | `spaces.setInstructions` | the buttons are disabled; closing the sheet does not cancel | the sentence in the sheet, the text kept | M9 |
| Show chat, Hide chat | nothing (state changes at the press) | a request arriving in the same tick is judged against the state the tick leaves | — | M6 |

## Acceptance

The acceptance is the section's A3 to A10 as written there, read with the corrections of "Where the section no longer holds". "Unit" is run by the milestone's executor on the VM and again by class 1a. "Scene" is written by the milestone named and run by the architect on a Mac. Routes are in "Routes".

| item | proved by | milestone |
|---|---|---|
| A3: asked for a one-page memo, the agent sets the page, exports a PDF, and its answer names the page count; the Export menu shows the same size and "Compact" checked; the owner's own PDF has the same count | unit: `set_page` through the real document service (one row, the agent's), the read's `page`, the export's precedence and compact tokens, `countPdfPages`. Scene, new, in `e2e/document.spec.ts`: an agent's `artifact_edit` with `set_page { size: 'a4', density: 'compact' }` on a memo that is two pages at standard density; `artifact_export` answers `pages: 1`; the window's Export menu shows "A4" and "Compact" checked; the menu's PDF, saved, has one page by the scene's own count; the scene attaches the standard and the compact PDF | M2, M3 |
| A4: the agent deletes a draft it made; one row, "Deleted <title>", with Undo; the Library no longer lists it; Undo brings it back and the row reads "Restored <title>"; an artifact the owner made or edited is refused with the reason; on another machine the row and Undo act there, and Undo is disabled with its sentence while that machine is offline | unit: M4's store and tool cases, the row's cases, the route's cases. Scenes: in `e2e/maws-tools.spec.ts`, the nineteen tools and the two refusals; in `e2e/library.spec.ts`, the row, the Library without the draft, Undo, the draft back; in `e2e/remote.spec.ts`, Undo on another machine's library and the disabled Undo with that machine stopped | M4, M5 |
| A5: publish by path (the call's input holds a path); the `html` export equals the published file byte for byte; "Save a copy…" in an HTML artifact's Export menu; asked for a dashboard the reader can filter, the agent makes an HTML page and says why | unit: M1's cases. Scenes: in `e2e/artifacts-store.spec.ts`, publish by path then export `html` and compare sha256; in `e2e/library.spec.ts`, "Save a copy…" in the row menu and in the viewer. The last clause is the guide's sentence, held by a unit case on the guide's text; what an agent then does is not proven by a scene (Proof, 10) | M1, M3 |
| A6: Expand leaves only the box at the lower right; its close control removes it; the header shows "Show chat", which brings the bar back with the keyboard in it; Open conversation brings the conversation back; a request while hidden leaves it hidden and takes no keyboard; while the bar shows, a request opens the card; on all three routes and over a side surface | unit: §F.1's table case by case, the bar's drawing, the two header controls. Scenes, in `e2e/panel.spec.ts`: the split's float over a document (Expand, the bar's parts by role, Hide chat, Show chat and where the keyboard is, a permission request raised while hidden, the same while the bar shows); the panel's float over a side surface; in `e2e/layout-transfer.spec.ts` the two cases that read the compact region. The terminal route and the other machine's are the bar showing what the pane shows, by unit cases over `SessionPane`'s compact branch with a holder notice and with an offline machine's notice. "Show chat carries the waiting mark" is a unit case; the bar's one line "Waiting for you · N" is U1b's and is proven on the first master that holds both | M6, M7 |
| A7: four cards and a More menu, one design-system choice in the heading; a card leaves the page for a new chat whose composer holds the opening words; with a system chosen, the artifact the agent makes is governed by it; "Blank" makes an empty artifact in that system and opens it | unit: M8's cases; the tool's `designSystem` through the real store (the new artifact's own system, the guide). Scene, in `e2e/library.spec.ts`: the four cards and More; a system chosen; a card clicked, the page left, the composer's words; "Blank" and the opened artifact naming the system (a deck's Theme panel, a document's breadcrumb: H25) | M8, M11 |
| A8: instructions written from the Space's menu; a chat started from that Space carries them as one chip; a session started elsewhere is given them in the tool's answer, once, and again only after the text changes or a compaction | unit: M9's and M10's cases, the compaction through the recorded frame. Scene, in `e2e/library.spec.ts`: the sheet, the mark, a card clicked, the chip in the draft by its name | M9, M10, M11 |
| A9: an agent's edits still appear live (l6-artifacts-02); every session MAWS launches still has `artifact_create` (l6-artifacts-03); a deck's history line reads as before (l6-artifacts-10) | `e2e/document-presence.spec.ts` and `e2e/presentations-history.spec.ts` as they stand, in each pull request's groups; `tools.test.ts`'s list still holds `artifact_create` first among the artifact tools | every pull request |
| A10: a type sample is whole in its cell; each component of the three bundled systems is legible and not clipped; the owner looks at the component cards on a Mac | unit: `DesignSystemPage.test.tsx` (the canvas, the scale at a 384 px box). Scene, in `e2e/design-systems.spec.ts`: the title sample's cell at a narrow width has no horizontal overflow; each bundled component's frame document, loaded at the canvas size, has no overflow. The owner's look: Proof, 3 | M11 |

The last milestone of each pull request runs Concrete Steps 4 and its own lines below, and writes their output into Progress.

    # U10b-1 (M3): no migration, nothing between processes, nothing over the link
    git diff origin/master...HEAD --stat -- src/engine-host/documents/migrations.ts src/shared/ipc src/shared/artifacts/entity.ts src/endpoint apps/org-protocol src/shared/maws/instructions.ts
    # U10b-2 (M5): no migration, no entity field, no change to the endpoint's target rules; exactly one offer added
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
| 1 | **The drawn examples and the owner's cards** | before M3, M5, M7, M8, M9, M11 | "The look": six pages of frames at real sizes, with invented content, and seven cards | the owner's answers; each changes one place the card names |
| 2 | **The owner's look at a memo at two densities** | on the drawn example before M3; on the built branch before U10b-1 lands | the two PDFs A3's scene attaches (an invented memo, standard and compact, Letter) | the owner's word; a different number is `COMPACT` alone |
| 3 | **The owner's look at the component cards** (A10; closes two tracker rows) | before U10b-4 lands | the branch running on a Mac, a design system's page for each of the three bundled systems at three columns | the owner's word. A component that reads badly at the canvas reached is the declared-size route, a new item |
| 4 | **The owner's look at the bar and "Show chat"** | on the drawn example before M7 | page 1 of "The look" | answers to cards 1, 5 and 7 |
| 5 | **The new and reworked scenes, alone** | after each pull request's last milestone | a Mac under the load rule. U10b-1: `e2e/document.spec.ts` (the export scene, A3's) in `e2e:document-app`; `e2e/artifacts-store.spec.ts` in `e2e:artifacts`; `e2e/library.spec.ts` in `e2e:library`. U10b-2: `e2e/maws-tools.spec.ts` in `e2e:tools`; `e2e/library.spec.ts`; `e2e/remote.spec.ts` in `e2e:remote`. U10b-3: `e2e/panel.spec.ts` in `e2e:panel`; `e2e/layout-transfer.spec.ts` in `e2e:default`. U10b-4: `e2e/library.spec.ts`; `e2e/design-systems.spec.ts` in `e2e:design-systems` | a verdict per scene; a red scene goes back as a fix |
| 6 | **The groups each change reaches** | after the scenes alone are green | U10b-1: `e2e:document-app`, `e2e:document`, `e2e:dashboard` (its export scene picks "PDF (.pdf)" and "Markdown (.md)", which a dashboard keeps), `e2e:artifacts`, `e2e:library`, `e2e:remote` (another machine's PDF export), `e2e:deliverables` (a replayed publish with `files`), `e2e:panel` (its Export › PDF scene), `e2e:tools`. U10b-2: `e2e:tools`, `e2e:deliverables` (the artifact row's replay), `e2e:library`, `e2e:remote`, `e2e:machines`, `e2e:transcript`. U10b-3: `e2e:panel`, `e2e:default`, `e2e:browser` (the chip, unchanged), `e2e:composer` and `e2e:side` (the composer's frame and the `/btw` card with the bar property off), `e2e:layout`. U10b-4: `e2e:library`, `e2e:design-systems`, `e2e:tools`, `e2e:composer` (a prefill's chip), `e2e:document-app` (a document's create). `e2e:requests` and `e2e:discover` cross none of it | verdicts by group |
| 7 | **The cross-build runs** | after the last milestone of U10b-1, U10b-2 and U10b-4 | `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build` in the background. U10b-2 and U10b-4 take a wire minor and owe two runs each: `--peer-exact 2c7044231` and `--peer-exact f1852de3a`. U10b-1 takes none and owes one, `--peer-exact 2c7044231`; its scene does not skip on an equal wire. U10b-3 stores and sends nothing and owes none; its pull request says so with the `--stat` above | the runs' ids; a red is read against the same command on master |
| 8 | **The branch reviews** | after each last milestone | `doperpowers:review-code` at the rung "Size and review" names, with its lenses; U9 reads M4's insertions in its files | a verdict and findings; fixes are one wave through the controller |
| 9 | **A probe, offered and not required: what the engine does with `destructiveHint`** | any time | a session on engine 2.1.322, off the worktree's machine, with a `maws` tool annotated `destructiveHint: true`, called under `default`, `acceptEdits`, `auto` and `bypassPermissions`; the permission request (or its absence) recorded as a fixture | a findings file. Nothing built here depends on it; it settles what the owner is told about when an agent's delete asks first |
| 10 | **A paid live scene, for the architect to decide** | once, on U10b-4's final head | `e2e:library-live`, one new scene: from the opening words with a chosen system and a Space with instructions, a real agent's `artifact_create` passes `designSystem` and its answer carries `spaceInstructions`. It is the only proof that an agent acts on the words; it spends on the owner's account, so it is the architect's call under the root's rule for paid groups | a verdict, or the decision not to run it |
| 11 | **The deck stage at 1280 px with the bar** (l6-artifacts-04's owed look) | with U10b-3's Mac runs | a deck beside a session at a 1280 px window, Expand | a note; a fault is U14's item |
| 12 | **Class 1a** | once per pull request, on the head it will carry, after the review's fixes | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label <u10b-n>`, in the background | the run's id |

## The look

Two drawn examples of this wave found faults the text had missed, so every new or changed surface below is drawn at real sizes before it is built. The frames are described here and drawn by the architect's example builder outside the repository, with invented labels, titles and text (root UC-11). The window is 1440 × 900 unless a frame says otherwise.

**Page 1 · The chat over an artifact (before M7).**

1. A document in the main area after Expand, the bar at the lower right: the box 420 px wide with the float's border and shadow, the two icon buttons at its right, nothing above or under it. Beside it, today's pill at the same place, for the difference.
2. The bar with two attached files and one waiting message above the box, over a dense page of text: once with what is above the box on one raised surface, once with nothing behind it (card 1).
3. The bar with the line "Waiting for you · 2" above the box and the waiting mark on Open conversation.
4. Hidden: the document's header with "Show chat" before Restore split; then with the unread mark; then with the waiting mark.
5. The chat floated over a side surface: "Show chat" before the float control in the side column's first strip, at 360 px with four tabs open and at the wide width (card 5).
6. The bar of a terminal session that cannot be driven (the holder's notice with the two buttons) and of a session whose machine is offline.
7. The bar over a main tab with no header (a file): Open conversation only.
8. The bar with a long draft (the box grown to a quarter of the window's height), and the card it opens, for scale.
9. A deck's stage at a 1280 px window with the bar.

**Page 2 · A memo at two densities (before M3; M2 builds the numbers as written, and they are one constant).** One invented memo, drawn with the repository's own export stylesheet and the house system's tokens at Letter: at standard density (it runs a few lines onto a second page) and at compact (one page), side by side at the same zoom; the same pair for one bundled system; and the document's Export menu open, with the four formats and "Letter" and "Compact" checked (cards 2 and 3).

**Page 3 · The transcript's row for a delete (before M5).** "Deleted Draft plan" with Undo; "Restored Draft plan" with Open; Undo disabled with "Restore is unavailable while <machine> is offline."; "Could not delete Budget: the user has edited "Budget"; ask them to delete it in the Library"; the row in a folded turn. At the transcript's column width and in the 560 px card.

**Page 4 · "Make something new" (before M8).** The section on the Library page narrowed to a Space, at 1440 and at 1100 px: four cards, More, and the choice in the heading after the Space's name; the choice open ("Classroom · default" and two more); More open; a card under the pointer with its "Blank" link; the cards disabled while the Space loads; the page on "All Spaces" (card 4).

**Page 5 · A Space's instructions (before M9).** The Space's menu with "Instructions…"; the sheet empty and with twenty lines of text, at the library's sheet width; the mark on a Space's heading line in "By Space" and on the narrowed page's bar; the new chat's composer with the opening words and the chip `Instructions for “Research”` (card 6).

**Page 6 · A design system's page (before M11).** For the three bundled systems at three columns: each component card on today's canvas and on the 960 × 540 canvas, side by side; the tallest component (a four-row table) alone at the new canvas; the title's sample in a narrow cell, cut as today and broken inside the word.

**Cards for the owner**, the most consequential first. Each question stands on its own; the first option is the one recommended and the one built unless the owner answers otherwise.

1. **Over an artifact the chat shrinks to its box alone. When files are attached or a message is waiting to be sent, they are drawn above the box. What should be behind them?**
   - *One raised surface from the topmost of them down to the box, only while something is there (recommended).* The chips and the waiting message are readable over any page, and with nothing attached the bar is the box alone, as you asked.
   - *Nothing: each chip and row stands on the artifact.* The smallest footprint, but text over text is hard to read over a dense document.
   - *Always a surface around the box.* Steady, but it is the frame you asked to remove.
   - Place: the bar's wrapper in `shell/FloatingPill.tsx`.
2. **A document's Export menu will show its page: "Letter", "A4" and "Compact", with a check mark. How should the two sizes behave?**
   - *One of the two is checked whenever the page is Letter or A4, whether the document or its design system says so; choosing the other switches (recommended).* The menu always says what the PDF will be.
   - *A size is checked only when you chose it for this document; unchecked means "as the design system says".* Shows whose choice it is, but an unchecked menu does not say what will print.
   - Place: `documentExports` in `tools/document/header.ts`.
3. **"Compact" makes a document's exports tighter so that a memo fits a page: type at 90 %, the space between blocks at 75 %, page margins no wider than 0.75 in. Looking at the memo at both densities, is Compact right?**
   - *As drawn (recommended).*
   - *Tighter: type at 85 %, spacing at 60 %.* Fits more; small type on paper.
   - *Spacing only: type stays, spacing at 60 %.* Keeps the reading size; fits less.
   - Place: `COMPACT` in `src/artifacts/document/export/design-system.ts`.
4. **"Make something new" becomes four cards, each one button that starts a chat. What does a card show?**
   - *The kind's icon, its name, one line that says what it is for, and a small "Blank" link at the card's corner (recommended).* A first-time reader learns what a Design is; the row is about 96 px tall.
   - *The icon, the name and "Blank" only.* A shorter row; the one-line description moves to the tooltip.
   - Place: the card in `library/MakeSomethingNew.tsx`.
5. **With the chat hidden over a side surface, "Show chat" stands in the side column's tab row. In a narrow column that row is short. What should "Show chat" be there?**
   - *The words, always; the tabs give up their titles first, as they already do when the row is short (recommended).* The control you asked for stays findable by its name.
   - *An icon alone when the column is under 420 px.* More room for tabs; the words are in the tooltip.
   - Place: `RegionControls` in `panel/PanelHeader.tsx`.
6. **A Space that has instructions shows a mark on its heading line. Which?**
   - *The word "Instructions", small and muted, which opens the sheet (recommended).* Says what it is without a legend.
   - *A small icon with the word in its tooltip.* Quieter; needs learning.
   - Place: the mark in `library/Rows.tsx` and `Library.tsx`.
7. **The bar has two small buttons: one opens the conversation, one hides the chat. Which glyphs?**
   - *The expand glyph the pane's header uses for "Expand pane", and a plain ×, as the card's own Close (recommended).* Both are glyphs you already read in this place.
   - *A chat bubble and a chevron pointing down.* Says "chat" and "put away"; two glyphs new to the app.
   - Place: the two buttons in `shell/FloatingPill.tsx`.

## The pull requests

Each is opened on the architect's word, not by an executor. Each body opens with the composite's path, the child id (U10, second landing, and which of its four pull requests), the parent pin `93905c9ef` and board ticket 595; names its items; names its class 1a run by id on the head it carries; names the branch review's verdict and what was done with each finding; says which scenes and groups ran and where; names its cross-build runs by id, or says why it owes none; names its residue; and ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and no other attribution.

The dated amendments each carries, where the ruling stands (the section's "Rulings reversed", with the corrections of this document):

| pull request | amendment | where |
|---|---|---|
| U10b-1 | "Amended <date> (UX wave, U10): the document's own page setting comes after the export call's choice and before the system's; the Export menu's size rows become the document's setting." | P3-B Decision Log 43, `docs/doperpowers/plans/2026-10-12-p3-b-documents.md` |
| U10b-1 | one dated line each: `path` on `artifact_publish`; the op `set_page` and `page` in a document's read; `html` as an export format of an HTML artifact and `pages` in a PDF export's answer | charter X9, `docs/charter.md` |
| U10b-2 | one dated line: the tool `artifact_delete`, annotated destructive; undone by the command `artifacts.undelete` (not `artifacts.restore`, which is the version restore) | charter X9 |
| U10b-3 | "Amended <date> (UX wave, U10; the owner's O-43): the compact composer is the bar alone, with Open conversation and Hide chat on it; hidden, the header shows Show chat, the place and the word of Claude Desktop 5.1231.2's hosted-artifact frame, where the worded button is behind server gates and the frame otherwise draws a labelled Chat toggle; a request that arrives while the chat is hidden leaves it hidden and marks Show chat. The presentation stays transient." (The section's sentence, with the one correction of fact from the citations above.) | P4 Decision Log 83, `docs/doperpowers/plans/2026-10-19-p4-smoothing.md` |
| U10b-4 | "Amended <date> (UX wave, U10): `artifact_create` takes `designSystem` (an id or a name) and binds the new artifact to it; the owner's choice on the Library page reaches the agent through it." | charter X9 |
| U10b-4 | "Decision Log 13 amended <date> (UX wave, U10; the owner's mark on l6-artifacts-08): four kinds are cards and the whole card asks Claude; Blank is a link; the other kinds are under More." | `docs/doperpowers/plans/2026-10-12-p3-l-library.md` |
| U10b-4 | one dated line each: `space` on `artifact_describe_type`; `spaceInstructions` in three answers | charter X9 |
| U10b-4 | X23: a Space's instructions are held beside the entity, in the store's `meta` table, and read and written by `spaces.instructions` and `spaces.setInstructions`; `SpaceSchema` is unchanged | the P3 interface ledger's X23 entry |

Tracker rows (`docs/tech-debt-tracker.md`), added by the pull request named and with no board ticket now:

1. (U10b-2) The agent's delete refuses a deck or a design the owner only opened, because opening still writes rows credited to the person there (H3). Closes with the rest of l6-artifacts-09.
2. (U10b-2) After an engine-host handover a side thread's lineage is empty, so it cannot delete a draft its parent made (H13). Closes when an adopted session is given its scope.
3. (U10b-1) A machine of an older build stores a document's page and ignores it at export; this window's menu there shows the setting all the same (§G). Closes when no older build is a peer.
4. (U10b-4) The name of an instructions chip is not kept once the message is sent: the transcript shows "Pasted text #1". Closes with a name carried in the sent form, a composer item.
5. (U10b-3) In the bar the three menu chords of the composer do nothing, and a plugin's hint is not drawn (H11). Closes on the owner's word if either is missed.

Rows 195 and "364" (H26) close on the owner's look at the component cards (Proof, 3), through the board scripts, by the session that keeps them.

## Size and review

Counted from the code at the pin: the functions and tests each milestone changes, and the scenes it writes. "Files" counts source, tests, scenes and documents.

| milestone | source | tests | scenes | files |
|---|---|---|---|---|
| M1 | about 160 | about 270 | about 70 | about 17 |
| M2 | about 330 | about 540 | — | about 22 |
| M3 | about 190 | about 260 | about 200 | about 15 |
| **U10b-1** | **about 680** | **about 1,070** | **about 270** | **about 48** (about 2,000 lines) |
| M4 | about 340 | about 580 | — | about 30 |
| M5 | about 210 | about 340 | about 250 | about 20 |
| **U10b-2** | **about 550** | **about 920** | **about 250** | **about 46** (about 1,700 lines) |
| M6 | about 120 | about 330 | — | 2 |
| M7 | about 270 | about 430 | about 230 | about 18 |
| **U10b-3** | **about 390** | **about 760** | **about 230** | **about 20** (about 1,400 lines) |
| M8 | about 270 | about 390 | — | about 12 |
| M9 | about 290 | about 420 | — | about 22 |
| M10 | about 220 | about 430 | — | about 11 |
| M11 | about 70 | about 90 | about 270 | about 12 |
| **U10b-4** | **about 850** | **about 1,330** | **about 270** | **about 52** (about 2,450 lines) |

What the counts rest on, for the largest: M2's planner (`apply` 56 lines, `targetsOf` 15, `Plan` 17, `applyEdit` 10), the edit tool (133) and the read tool (69), `exportDesign` (7) and `pageOf` (8) with their callers, and eight test files that pin page sizes. M4's `delete` (19 lines) beside which two methods of about that size stand, seven registries with one row each, and five test files that pin the offer table. M7's `Pill` (about 45 lines) rewritten, `Frame` (20 lines of markup), and four test files of 172 to 660 lines in which about twenty cases name the pill. M8's `KindCard` (43 lines) and `MakeSomethingNew` (17) rewritten and nine cases of `Library.test.tsx`. M10's five tool paths (104, 89, 68, 69 and 29 lines).

**Review.**

| pull request | rung | why | lenses |
|---|---|---|---|
| U10b-1 | the xhigh panel | about 48 files; a new write to every document's shared content | the plan's all-or-none with an op that changes no block, and one row per write (U10a's constraint); what both older builds do with `page` (§G), restore and suggestions included; the export's precedence and the compact tokens across PDF, Word, web page and screenshot; the menu's write as the person's row and the wait before an export |
| U10b-2 | the xhigh panel | delicate: an agent's destructive tool, and an offer over the machine link (the root names U9's offers delicate) | the three rules evaluated in the store's batch and the race with a person's write; the mark as the bound of the offer, and the sweep for promotions on the final diff; U9's rule followed place by place, the capability and the held act's `requires`; the row's state read and its sentences on each route |
| U10b-3 | `doperpowers:reviewer-high` | about 20 files in one area, nothing stored or sent; the risk is the keyboard's hand-offs | §F.1's table against the code, row by row, the request rule in the same tick included; every reader of `closed` outside the shell; the insertions in U4's, U8's and U9's files at their smallest |
| U10b-4 | the xhigh panel | about 52 files across the store, the tool server, the composer and the Library | no migration and no entity change (§G), and what an older engine host answers; "once per session" across compaction, replay, linked reads and adoption; `designSystem`'s resolution and the kinds; the card's awaited start and the page left |

Class 1a on GitHub Actions is the gate of record for each.

## What was not verified

- The owner's look at the screenshot of the caret under a final chart (U10a's): the repository records the scenes green, not the look.
- What an older build's accept of a suggestion does with an unknown attribute on the settings node: its pairing walks every root's attributes; read, not run. The cross-build scene of U10b-1 accepts a suggestion on the peer.
- Whether the history rail lists a revision that changes only the settings node, and what `sinceRevision` answers after one. M2's executor reads it; a page-only revision that the rail shows as an empty change is reported, not patched.
- Whether a replica still attached to an artifact that was deleted can write to it. This is today's behaviour for the person's delete too; M4 changes nothing there.
- Whether the kind adapters' forgotten state is rebuilt when an artifact comes back: read as lazy, not run. M4's undelete test opens the restored document through the real service and edits it.
- Whether `overflow-wrap: anywhere` breaks a Korean word under `word-break: keep-all` in the app's Chromium: the scene of M11 decides it; the section's fallback is named.
- Whether every bundled component fits 960 × 540 in height: M11's scene decides it.
- What the engine does with `destructiveHint` (Proof, 9).
- Whether events wired in at an engine-host handover reach `SessionMaws.observe`; either answer is covered by M10's decision 5.
- What Claude Desktop draws beside its seated composer; the section's sentence that it was not traced stands.
- That no promotion exists was established by a sweep of the call patterns named under "Routes", not by an exhaustive read of every `bus.invoke` site.

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

## Decision Log

- Decision: the verification call. This document gets an adversarial review before any executor starts, dispatched by the architect. Each of the four branches gets `doperpowers:review-code` at the rung "Size and review" names: the xhigh panel for U10b-1, U10b-2 and U10b-4, `doperpowers:reviewer-high` for U10b-3. Class 1a on GitHub Actions is the gate of record for each pull request; the cross-build runs are the ones "Proof", 7 names.
  Rationale: three of the four are of panel size or delicate by the root's own list (an offer over the link); the fourth is one area with nothing stored or sent.
  Date/Author: 2026-11-15, the author of this document.

## Outcomes & Retrospective

Pending — written at finish.
