# UX wave · U6, a landing of its own (U6d): an artifact mention is a link, and the agent opens no artifact by itself

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U6 (`docs/doperpowers/specs/2026-11-12-ux-wave/U6-files-links-keyboard.md`, cited below as *the child's file*), a landing of its own (**U6d**) for item O-44. **Parent pin:** master `c7b62e48b176dceba1620d16865dac2bef23b1b2`, the commit every statement about the code below was checked against; the root and the child's file are read at that commit.
>
> **The design is in this document.** O-44 stood under "Waiting" in the child's file until the owner answered on 2026-11-14. Its design was then drafted, reviewed adversarially, ruled on and revised outside the repository. The child's file gains that design in the spec's next batch, which is the architect's; until then this document is the design's record. "The design" below states it in full, and a builder reads this document and the code, nothing else. Where the child's file still says O-44 waits, this document holds.
>
> **Branch:** `ux-wave/U6d`, from master `c7b62e48b`; it depends on master alone. **Item:** O-44. **Not in this landing:** Word, PowerPoint and Excel files drawn inside MAWS (l6-artifacts-01), which is a later landing of U6 with its own execution document; U6b (ticket 592).
>
> **Revision 2 (2026-11-14).** The adversarial review of the first writing (`064e383ba`) returned three findings. The architect checked each in the code, accepted two and settled the third, and ruled on the eleven points the first writing reported. What moved: the link's key handler leaves alone a key an earlier listener already consumed; what is said of build F is narrowed to the artifact-call forms this landing writes, as a reading of F's source; the branch's review is the xhigh panel; the tooltip is one sentence that is true in every case; the snapshot test's differences are a named, dated list; the four other openers are listed as observed and left; a later relay of another machine's pane request is told where the refusal stands; and the tracker gains a row on the accent colour as text. Decision Log 6 and 7 hold the rulings.

## Purpose

When an agent names an artifact (a document, a deck, a page, a delivered file) in what it writes, MAWS draws the name as a small bordered box in the monospace font, the look of inline code beside it. It does not read as something to click. And the agent has a second way to put an artifact in front of the person: its tool `show_pane` can open the artifact beside the chat without being asked, which moves the person's view while they are reading something else.

After this landing a mention of an artifact reads as a link in the prose: the title in the accent colour, underlined under the pointer, wrapping across lines as the words around it do. A click opens the artifact beside the chat; when the artifact is already open as a main tab, the click shows that tab instead. A link to a file takes the same look, its text still in the monospace font. And only the person opens an artifact: `show_pane` no longer takes the `artifact` pane, a call that names it opens nothing and is answered with a sentence that tells the agent to write the link, and the three texts that invited the call are gone. Every transcript and journal recorded before the change reads as it did.

How to see it working: in a session whose agent wrote `[Launch plan](maws-artifact:<id>)`, the words "Launch plan" are accent-coloured text with no box; the pointer over them draws an underline; a click shows the artifact beside the chat with the transcript still in place; Tab reaches the link and Enter opens it. Open the artifact as a main tab (⌘-click), go back to the chat and click the mention again: the main tab comes forward and nothing opens beside the chat. Ask the agent to call `show_pane` with pane "artifact": nothing opens, and the call's row reads "Could not open pane: MAWS no longer opens an artifact for the user. …". A session recorded last week still reads "Opened Artifacts" where its agent opened one.

## Progress

- [x] (2026-11-14 22:01Z) Document written against master `c7b62e48b`: the design carried in full; every statement about the code, the tests and build F (`f1852de3a`) checked at that commit ("What the code holds today"); eleven points reported to the architect, each with the default built unless ruled otherwise.
- [x] (2026-11-14) The adversarial review of the document (three findings), and the architect's rulings on them and on the eleven reported points.
- [x] (2026-11-14 22:26Z) Revision 2: the rulings folded in (Decision Log 6 and 7); the two findings the architect accepted read again in the code (`dispatchKey` in `keymap/dispatcher.ts`; `ShowPaneResultSchema` at `f1852de3a`).
- [x] (2026-11-14 23:15Z) M1 — The agent opens no artifact: the texts, the two schemas, the refusal at the host and at the window, and old journals. Commits `6ef9a2acd`..`04deff757`; the red seen and each half-switch tried (Surprises); proof set of Concrete Steps 3 and 4 green on the VM; frontier review clean.
- [ ] M2 — The mention is a link: the element, the look, the click, the scenes, and the acceptance run.
- [ ] The proof an executor does not run: the scenes and their groups on a Mac, the one paid live group, class 1a, the branch's panel review, the pull request.

## The landing's edge

**In.**

- The look and the element of an artifact mention and of a path link wherever MAWS draws Markdown (an agent's answer and commentary, a tool result drawn as Markdown, a plan, a question, a rendered Markdown file, a mod's surface): link text in place of the box.
- The click: beside the chat, or the main tab that already shows the artifact; the keyboard's Enter and Space; the tooltip.
- `show_pane` without the `artifact` pane and without `at`: its description and input, the refusal at the engine host, the refusal in the window, the three invitations removed (the server's instructions, `artifact_create`'s description, the sentence that closes every kind's guide).
- Old records: a journal written by any earlier build yields the events it always did, and the transcript row of an old call reads as it did.
- The record: the charter's X9 paragraph and a dated entry in its §19 ("The pull request").

**Not included, and a later landing of U6.** Word, PowerPoint and Excel files drawn inside MAWS, read-only (l6-artifacts-01): a preview host chosen by a spike, with its own execution document, review panel and owner's cards. Once it lands, a File artifact of those kinds shows its preview in the view this landing's click opens. A file beside the chat, a PDF by a path, `file://` and relative links, the notices in plain words: U6b (ticket 592). This landing does not change where a file opens: a path link still calls `openFile` exactly as today.

**Not included, and nobody's.**

- "Show that tab" is for a mention only (ruled; "Reported" 4). Four other things open an artifact beside the chat through the same function, `openArtifactInPanel`. Each was observed and is left as it is, also when a main tab already shows the artifact; the architect tells the owner.
  - The Artifact row's Open opens the artifact beside the chat, at the version the row names.
  - A delivered file's name, in its row, opens that file's artifact beside the chat.
  - A browser action's row opens its screenshot beside the chat.
  - A side thread's return to its artifact's page (the comment card's re-dock, `side/ThreadView.tsx`) brings that page forward beside the chat for the card to dock on.
- The other chips that are drawn as a box keep it: the file chips of a read's and an edit's detail, the chip of an anchored comment, an attached file's chip, and the image chip, which opens nothing. The owner's card was about a mention and a file link "in the agent's text"; these are parts of a tool's row or of the person's own message.
- The panes `diff`, `file`, `terminal`, `tasks`, `browser` and `source-control` (the owner's answer on card C3: all six stay).
- Opening anything by itself when a turn ends (l6-artifacts-06, overtaken by O-44). A setting for where a link opens (law 3). A different look for a mention of an artifact that no longer exists: a click shows the record view's own "not found", as today.
- The desk's web page (`apps/desk-web`) draws Markdown with the same component: a mention stays its text there, as today, and a path link takes the new look with whatever click the desk's own actions give it today. No file of the desk is edited.
- The spec's files: the child's file and the root take this design in the architect's batch, not in this branch.

## Reported to the architect, and ruled

Each was a place where the code contradicts the draft this design came from, or where a choice changes what the person sees beyond the owner's words. The first writing reported eleven and named a default for each. The architect's rulings of 2026-11-14 (UTC) are in the fourth column and in Decision Log 7; the milestones build what is ruled.

| # | The point | Evidence | The ruling | Where it lands |
|---|---|---|---|---|
| 1 | **The probe's served snapshot is pinned from two sides, and this landing changes two things both sides read.** The draft lists neither the snapshot nor its two tests. | `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json` holds the instructions and `tools/list` the P4 fixtures were served. `src/shared/maws/search-tools.test.ts` ("the probe's snapshot of the maws server") requires it to equal the source, less the retired `message` tool. `spikes/protocol-probe/fixtures.test.mjs` (class 1a's probes gate) requires the recorded fixtures to hold `served4.instructions` word for word in five fixtures and `show_pane`'s `at` as the snapshot lists it. U12a and U5a each changed the snapshot in a place no fixture assertion compares. Here the instructions lose a sentence and `show_pane` loses `at`. | **The default stands.** The `instructions` string and the `show_pane` entry stay as served when the fixtures were recorded. The unit test's differences between source and snapshot are a short named list in the test, each with a dated reason, not an inline reversal. `artifact_create`'s string is edited. The P4-R7z tracker row gains the clause and says the two scenarios are recorded again at the next probe pass that touches them. No recording is arranged for this landing. | Decision 21; "The pull request" |
| 2 | **A replayed scene cannot show the new sentence in the call's row.** The draft's A14 reads as if the e2e scenes show it. | The row's label is drawn from the engine's own `tool_result` frame (`paneLabel`, `transcript/model/cells.ts`). Under replay that frame is the recording's: `e2e/fixtures/derived/p1-maws-show-pane-artifact.jsonl` holds "show_pane: the artifact pane is not available in this build of MAWS", and the two scenes say so in their comments ("the replay compares no bodies"). | **The default stands.** The replayed scenes assert the host's answer in the journal and the event, and keep reading the recorded label; the row's words are pinned by the model's unit test and, end to end, by the paid live group. | Decision 22 |
| 3 | **The normaliser's journal cases do not fail before the change.** The draft's A15 says both tests "fail before and pass after". | Today's one schema admits the pane, so a journal in build F's form, and one holding the new refusal, already normalise to the expected events. They fail only under a build that narrows the one schema both the host and the normaliser use. | **The default stands.** M1's steps make the red visible: the cases first, the narrowed schema turns them red, the recorded parser at both gates turns them green; the hand-back quotes the red run's failing case names. | Decision 24; Concrete Steps 2 and 8 |
| 4 | **How far "Show that tab" reaches.** The card asked about a click on a mention. The option the owner chose reads "one view of an artifact, as U6 rules for a file", and U6's rule for a file covers every opener. | Besides a mention, four things open an artifact beside the chat through the same function (`openArtifactInPanel`): the Artifact row's Open, a delivered file's name, a browser action's screenshot, and a side thread's return to its artifact's page (the comment card's re-dock, `side/ThreadView.tsx`). The Artifact row asks for a version, which the main tab's open does not take today. | **Mentions only.** The four others are listed under "Not included", one sentence each, as observed and left; the architect tells the owner. | Decision 6; "The landing's edge" |
| 5 | **The tooltip was not true in two cases.** | The draft's tooltip, "Opens beside the chat · ⌘-click opens it in a tab", was written before card C5 was answered. It is untrue when the artifact is open as a main tab (the click shows that tab) and for a mention outside any session's transcript (the click opens a main tab). A tooltip that follows the open tabs would subscribe every link to the layout store. | **One string that is true in every case:** `Opens the artifact · ⌘-click opens it in a tab`. No second string and no subscription to layout state. A path link's title stays its path. | `ARTIFACT_LINK_TITLE` (Interfaces §A); decision 16 |
| 6 | **Two refusals lose their only caller.** The draft says one refusal is added and none removed. | `TOOL_ERRORS.artifactNotFound` and `artifactUnreadable` are answered only by the window's `showArtifact`, which this landing deletes. | **Removed, with their tests.** | Decision 20 |
| 7 | **"Everything that opens on a click reads alike" is wider than what is built.** | The child's file, Waiting, O-44. The owner's card and answer were about a mention and a file link in the agent's text. | The two forms are built. The child's sentence is the architect's to reword in the spec's next batch, to the two forms in the agent's text; nothing in the child's file changes here. | Decision 15; "The pull request", the sentences that follow |
| 8 | **The size is more than twice the draft's estimate** (about 40 files and 1,250 changed lines against 17 and 400). | "Size and review" lists what the draft did not count. | **Accepted as counted.** The branch's review is the xhigh panel (the review's third finding, Decision Log 6). | "Size and review" |
| 9 | **A second live test names the pane.** | `test/live/maws-tools.live.test.ts`, case 4 (the vitest `live` project, run only under `MAWS_LIVE=1`; it records the fixture `p1-maws-show-pane`), expects a window to be asked for the `artifact` pane. | **Edited to the refusal, typechecked, not run**, and the document says plainly that it is unrun and why: a run records a fixture again. | M1; "Proof that an executor does not run" 3 |
| 10 | **Another machine's pane request does not reach this window yet.** The draft names it as a case the window's refusal covers. | At this head `maws.pane.answer` is offered to another machine (`src/endpoint/offers.ts`, behind the session-acts capability) but no code relays a `maws.pane.show` event from another machine to a window; U12's ticket 435 adds that. The case that exists today is this Mac's own engine host of an older build, which outlives an update of the app. | **Stands as a note**, with one sentence where the relay's landing will read it: the refusal is the first statement of the window's `showPane`, so a relayed request meets it too, and that landing adds the case to its tests. | Interfaces §H |
| 11 | **The link's colour on the light ground.** | The mention takes `--accent`, the colour a web link has today. The light theme's `--accent` on `--bg` is about 3.65 to 1 (the architect confirmed the arithmetic), under the 4.5 to 1 usually asked of text this size, and unlike the web link the mention has no standing underline as a second cue. | **Built as chosen.** It is the token's property and every web link has it today, so no value changes here. The tracker gains a row in this landing's record, owned by the visual renewal. | "The pull request" |

## What the code holds today

Checked at `c7b62e48b`. Paths under `src/renderer/src/` are written from `transcript/`, `tools/`, `library/` and so on where the folder is plain.

1. **The mention and the path link are buttons in a box.** `TranscriptLink` (`transcript/view/markdown/Link.tsx`) is the `a` of every Markdown surface. A `maws-artifact:` link whose id parses becomes `<button type="button" class="transcript-chip" data-chip="artifact" data-artifact-id data-artifact-at title="Open in the panel · ⌘-click opens it in a tab">`; a `maws-path:` link becomes the same button with `data-chip="path"` and the path as its title; a `maws-image:` link becomes a `span.transcript-chip` that opens nothing; any other link stays an `<a href>` that opens through the open-external action. No element ever carries a `maws-artifact:` href. Where the mount gives no `openArtifactTab` action (the desk's web page), the mention is its text. `.transcript-chip` (`transcript/view/transcript.css`) is an inline-flex box with a border, a raised ground and the monospace font at the small UI size; a web link in prose is `.transcript-prose a`: `--accent`, underlined.
2. **The click.** With the row's session known and no ⌘ key: `actions.openArtifact(session, artifactId[, undefined, at])`. Otherwise `actions.openArtifactTab(artifactId[, at[, machine]])`, with the session's machine when the session's id is an address. The two actions are registered once in `App.tsx`: `openArtifact` is `openArtifactInPanel` (`tools/artifacts/ArtifactsTool.tsx`), which brings the side column's Artifacts tab of that session forward on that artifact at the place, read on the session's machine when that is another machine and else on the machine the page's table gives the artifact (`artifactMachineOf`, `artifacts/machines.ts`); `openArtifactTab` (`library/actions.ts`) opens the main tab of kind `artifact`, or selects it where it is when the strip already holds it, and asks the tab's editor for the place only when one is given.
3. **A second click site.** A mod's surface draws Markdown through the same component, but its `MarkdownNode` (`engine-surface/SurfaceTree.tsx`) takes every click in the capture phase: it finds the mention by `closest('[data-chip="artifact"]')`, rebuilds the link from `data-artifact-id` and `data-artifact-at`, and repeats the rule of point 2 for the surface's own session with the registered actions. In a session MAWS runs with a mod that draws the agent's messages, this is the path a click takes.
4. **A comment card's thread** overrides `openArtifact` for the artifact whose page the card is on: the card's own viewer shows it (`useCardActions`, `side/card/CardThread.tsx`).
5. **One strip, one app window.** Main creates one app window and reuses it (`appWindows()[0] ?? openWindow()`, `src/main/app.ts`); the presentation window and the repair window are not app windows. The open main tabs are `useLayout.getState().main` (`stores/layout.ts`, the one strip since U13a); `allTabs` and `isOpen` (`stores/layout-model.ts`) read it; an artifact's tab has the id `artifact:<machine>:<artifactId>` (`tabId`, `src/shared/ipc/schema/layout.ts`). Opening a tab the strip holds activates it in the pane it is in, and showing a tab closes an open page (`commitShown`).
6. **The keyboard already treats a `role="button"` element as a button, but an app-scope chord is taken whatever has focus.** `isButtonOrLink` in `keymap/dispatcher.ts` matches `button, a[href], [role="button"], [role="link"]`, so a pane-scope Enter is not taken from a focused link; the comment card's click test (`CommentCard.tsx`) lists `[role="button"]` too. The dispatcher listens on the window in the capture phase; when a key belongs to a binding it calls `preventDefault()`, runs the binding and does not stop the event (`dispatchKey`), and `refused` lets an app-scope chord that has a modifier through whatever the target. A key it took therefore still reaches the focused element's own handler, with its default prevented.
7. **The tool.** `MAWS_TOOLS.show_pane` (`src/shared/maws/tools.ts`): the description is 577 characters and names seven panes; `ShowPaneInputSchema` is a strict object of `pane` over `PANE_NAMES` (`src/shared/maws/panes.ts`, seven names), `target`, `line` and `at`, with two refinements (`line` for the file pane only, `at` for the artifact pane only). `tools/list` answers `z.toJSONSchema` of that schema. `parseToolArguments` parses a call with the tool's input schema and words a refusal: an unknown pane is named with `PANE_NAMES`, anything else by its issues.
8. **The three invitations.** `MAWS_SERVER_INSTRUCTIONS` (`src/shared/maws/instructions.ts`) is 699 characters and holds "Call mcp__maws__show_pane only when the user should see it now. "; `artifact_create`'s description is 1,328 characters and ends "…a click opens it in MAWS; call show_pane only when the user should see it now."; `LINKED` (`src/artifacts/types/guides.ts`) appends to every kind's guide a paragraph that ends "… Call show_pane only when the user should see it now.". No other text the agent is served invites the call (the kinds' own guide files do not name the tool).
9. **The host and the window.** `showPaneTool` (`src/engine-host/tool-server/show-pane.ts`) refuses what `parseToolArguments` refuses and otherwise asks the windows through the pane bridge, `at` included. The window's `showPane` (`tools/maws/panes/connect.ts`) answers a `maws.pane.show` request: for `artifact` it resolves the target through three lookups (`artifactOf`, `artifactIn`, `ancestorsOf`: `artifacts.get`, `artifacts.list`, `session.get`) and opens the Artifacts tab (`showArtifact`), answering `artifactNotFound` or `artifactUnreadable` when it cannot. The request's schema, `MawsPaneShowSchema` (`src/shared/ipc/schema/maws.ts`), is strict, with `pane` over the seven names and an optional `at`.
10. **The normaliser decides twice with the execution schema.** `src/engine-host/normalizer-controls.ts` turns the engine's frames into events, live and again whenever a journal is read. `mapInboundRequest` marks a `maws` call `admitted` only when `parseToolArguments` accepts its arguments; `mapMawsAnswer` returns at once for a call that was not admitted, parses the arguments again, and emits `maws.pane.shown` with the pane, the target, what opened, or the error text. A call the schema refuses therefore yields no `maws.pane.shown`, only its `tool.result`. The file already keeps two retired forms readable by their own schemas (the removed browser tools, `parseBrowserToolArguments`; the retired `artifact_update`).
11. **An old call's row.** `paneLabel` (`transcript/model/cells.ts`) reads "Opened <the panel tool's title>" from the stored result, "Opening the <pane> pane" while unanswered, and "Could not open pane: <the error without its `show_pane: ` prefix>" for an error.
12. **Build F.** `git diff f1852de3a c7b62e48b` is empty for `src/engine-host/normalizer-controls.ts`, `src/shared/maws/panes.ts`, `transcript/view/markdown/Link.tsx` and `src/artifacts/types/guides.ts`; F's `ShowPaneInputSchema`, `parseToolArguments` and `paneLabel` are the functions of points 7, 10 and 11, word for word. F's `ShowPaneResultSchema` is not today's: it is a strict object of `status`, `pane` and `opened`, without the optional `page` and `note` U12a added.
13. **Facts about the engine, from recorded fixtures.** A call whose `pane` is outside the listed enum reaches the server (`spikes/protocol-probe/fixtures/pass3/p1-maws-show-pane.jsonl` holds the call for `nope`), so a call for `artifact` will reach the host after the enum loses it. A resumed session keeps the instructions it was first given (`fixtures.test.mjs`, "p4 resume", recorded on 2.1.304; not recorded on the pinned 2.1.322, and nothing here depends on it: the refusal is the same either way).
14. **No find.** The action table has no `transcript.find` at this head; U3b builds it, over the model's rows.

## The design

Each decision is marked: **[owner]** settled by the owner's words or card answers (Decision Log 1 and 2); **[ruled]** by the architect's ruling or the P5 architect's conditions (Decision Log 3); **[design]** settled here, with the alternative it beat, numbered so that a ruling can name it.

### The mention is a link

**The look** [owner: card C4, "As Claude Desktop (Recommended)"]. A `maws-artifact:` mention is link text: the title in the font and size of the prose around it, in the accent colour, with an underline only while the pointer is over it; no glyph and no box. A web link keeps its standing underline, so what opens inside MAWS and what leaves it differ by one mark at rest. The owner was told on the card that under the pointer the two look the same, and chose it. This is how Claude Desktop draws a file reference in a transcript: `inline box-decoration-clone text-accent hover:underline …` on a `role="button"` span (`web/app/v1/c86240138-zX8NMSxf.js:5-8`; the component, `web/app/v1/c856385e2-DPBwiU-E.js:2142-2300`, in `app-5.1231.2`).

**The path link** takes the same element and the same look in this landing, its text still in the monospace font (the child's file asked that a path link take the link's look in the same change). The image chip, which opens nothing, keeps the box.

**The element** [ruled]. The mention and the path link are each a `span` with `role="button"` and `tabindex="0"`, not a `<button>`: a button is an inline-block box in Chromium, so a long title could not wrap across lines as prose does, and a title longer than the column would overflow or break as one box. The span is an ordinary inline element. It keeps `data-chip="artifact"` with `data-artifact-id` and `data-artifact-at`, or `data-chip="path"`, which a mod's surface and the tests read; the attribute's name is history. It is activated by a click, by Enter and by Space. Interfaces §E gives the markup, the style rules and the keyboard.

What the ruling left to settle:

- **Decision 8, keyboard activation is a click** [design; its first clause ruled, Decision Log 6]. The key handler first does nothing at all when the event's default was already prevented: the keymap's dispatcher has then run a binding for that key ("What the code holds today" 6), and without this test a ⌘Enter or a modified Space bound to an app action would run that action and also open the focused link. Otherwise, on `keydown` of Enter or Space, not a repeat, the element calls `preventDefault()` (for Space this is what keeps the transcript from scrolling) and dispatches one `click` mouse event on itself, bubbling, cancelable, carrying the key event's `metaKey`. Everything that handles the link's click then handles the key the same way: the component's own handler, and the capture-phase handler of a mod's surface, which opens the artifact for the surface's own session. It beat calling the open function from the key handler: under a mod's surface the click is taken before the component, so a key that bypassed the click would open through the wrong path. Activation on `keydown` for both keys is the P5 architect's condition; a native button fires Space on `keyup`, and the difference is not visible.
- **Decision 9, modifiers.** ⌘Enter is ⌘-click, unless an earlier listener consumed the key (decision 8). A held key opens once. Shift, Option and Control are not read.
- **Decision 10, focus** [design]. Focus order is document order, where the button stood. The ring is drawn as a box decoration, a 2 px ring in `--accent` by `box-shadow` with `box-decoration-break: clone`, so that each line's part of a wrapped, focused link is ringed and closed at both ends; the element's `outline` is off while it shows. This is Claude Desktop's mechanism for the same element (`focus-visible:shadow-focus` with `box-decoration-clone`). It beat the transcript's standing `outline` rule, which matches `button` and `a` and no longer matches the link, and which `clone` does not govern: an outline is not a box decoration.
- **Decision 11, what assistive technology reads** [design]. Role button; the name is the link's text; the description is the `title` (the tooltip for a mention, the path for a path link). No `aria-label`: it would replace the visible text.
- **Decision 12, selection and copying** [design]. The link's text is ordinary text: a selection can start in it, end in it or sweep across it. A click that ends a selection does not open: when the click came from the pointer and the document's selection is not collapsed and touches the element, nothing happens. A plain click, a double click's first click and the keyboard open as usual. It beat doing as Claude Desktop's component does (its click handler has no such test), because a span, unlike the button it replaces, lets the person select part of a title, and opening on that gesture would be new and unwanted. Copying a selected passage yields the link's text and no address, in the plain and the HTML flavour alike: no element carries the `maws-artifact:` address, as before. The row's own Copy still copies the Markdown source with the link whole.
- **Decision 13, find.** There is no find in a session at this head. U3b's find reads the model's rows, not the elements, so the change of element is nothing to it.
- **Decision 14, the tokens** [design]. At rest and under the pointer the text is `--accent`, the token a web link already uses, in both themes (the token has a value in each). The underline under the pointer is `text-decoration: underline` with the web link's `text-underline-offset: 2px`. The focus ring is `--accent`. There is no pressed colour and no visited state: the element is not an `<a href>` and has no history. No new token: a hover colour of its own would need one, and Claude Desktop's look has none. The path link adds `--font-mono` at `0.9em`, the size inline code has in prose.
- **Decision 15, the class.** The link's class is `transcript-inline-link`, declared beside `.transcript-chip` in `transcript/view/transcript.css`, which every Markdown mount already loads. `.transcript-chip` and its `button…:hover` rule stay for the chips that keep the box. The existing `.transcript-link` (a URL in a web tool's detail) is another thing and is not reused.
- **Decision 16, the tooltip** [ruled; "Reported" 5]. One sentence on every mention, `ARTIFACT_LINK_TITLE`, which does not say where the artifact opens and so is true beside the chat, in a main tab that already shows it, and outside any session; it needs no second string and reads no layout state. A path link's title stays its path.

### What a click does

**It opens the artifact beside the chat** [owner: "agent's artifact mention opens in the side panel"]. As today: the Artifacts tab of the row's session in the side column, brought forward on that artifact, at the place the link names, with the transcript keeping its place. For a session on another machine the artifact is read on that machine. ⌘-click opens the artifact as a main tab, as today and as a file link does. A mention outside any session's transcript (a rendered Markdown file, a document no session made) opens a main tab, the one place it can show. Where no artifact can open (the desk's web page) the mention stays plain text.

**Unless the artifact is already open as a main tab; then the click shows that tab** [owner: card C5, "Show that tab (Recommended)"]. The click brings that main tab forward and opens nothing beside the chat. What the answer left to settle:

- **Decision 1, where the click looks** [design]. In this window's one strip, `useLayout.getState().main`, for the tab whose id is `artifact:<machine>:<artifactId>`. The machine is the one the side column would have read the artifact on: the session's machine when the session is on another machine, else the machine the page's table gives the artifact, else this Mac. So the tab found is a view of the same artifact the click would otherwise have opened; two machines' artifacts may share an id, and a tab of another machine's is not taken. MAWS has one app window, so "this window" is the whole answer; were there a second, each window's click would read its own strip. It beat matching by artifact id alone (the wrong machine's tab), and asking the Artifacts tool what the side column shows (that is the other surface).
- **Decision 2, finding and showing are one act** [design]: `showOpenArtifactTab(session, artifactId, location?)`, which answers whether it showed a tab. It beat a predicate followed by a separate open: the two would each work out the machine, and a difference would open a second tab instead of showing the first.
- **Decision 3, the tab goes to the link's place** [design]. A mention that names a place (a block, a document's tab, a slide, a version) brings the main tab forward at that place, through the request `openArtifactTab` already makes of a tab's editor; a mention with no place brings the tab forward as it stands, at the version and scroll it shows. It beat only bringing the tab forward: the place is what the agent pointed at, ⌘-click on the same link already moves an open tab there, and going to a place changes no content.
- **Decision 4, ⌘-click** is unchanged: it opens the main tab, or selects it when open, at the place. With the artifact open as a main tab, a click and a ⌘-click therefore do the same.
- **Decision 5, open in both** [design]. When the artifact is open as a main tab and also shown beside the chat, the main tab comes forward and the side column is left as it is: not closed, not moved to the place. One rule, the main tab wins, with no case that depends on what happens to be in view. It beat preferring the side view while it is on screen (a second rule to learn) and closing the side view (a click that rearranges what the person laid out, the reason card C5's third option lost).
- **Decision 6, which clicks** [design; "Reported" 4]. A click on a mention, wherever MAWS draws one, a mod's surface included: one function holds the rule for both click sites, so they cannot differ. The Open of a row is not a mention and is unchanged.
- **Decision 7, inside a comment card's thread** [design]. A mention of the artifact whose page the card is on keeps opening in the card's own viewer, as today: the card answers "not shown" for its own artifact before its existing override runs. It beat letting the rule through: with the same artifact also open as a main tab, a click inside the card would take the person off the page they are commenting on.

The new branch awaits nothing: the strip is read and the tab shown in the click's own task, so there is no interval in which the person can act and nothing that can fail to arrive. Opening beside the chat is today's call, unchanged.

### The agent opens no artifact

[owner, by the reading the owner was told and did not contradict; it reverses charter X9, "The pull request"]. The register's line for O-44 already said it: the agent's ability to open artifacts by itself is removed.

**The tool keeps its name and loses one pane** [owner: card C3, "Keep all six (Recommended)"]. `show_pane` takes `diff`, `file`, `terminal`, `tasks`, `browser` and `source-control`. Its description, exact, is in Interfaces §A.

**Two schemas, each with one use** [ruled]. Execution and reading part ways for this one tool. `AGENT_PANE_NAMES` is the six panes `show_pane` carries out; `ShowPaneInputSchema`, what `tools/list` answers and what the host executes, is over those six and has no `at`. `PANE_NAMES` keeps all seven, every pane a record can name; `ShowPaneRecordedInputSchema` is today's schema unchanged, for reading records only; `parseRecordedToolArguments` is `parseToolArguments` except that `show_pane` is read through the recorded schema. The result's schema, the event `maws.pane.shown` and the request `maws.pane.show` keep the full list. Interfaces §B gives the signatures.

**The normaliser reads records with the recorded schema, at both of its gates** [ruled]: the admission in `mapInboundRequest` and the read in `mapMawsAnswer`. Interfaces §C is the table of what it then emits for each form a journal can hold. **Decision 18** [design]: every parse of a `maws` call's arguments in `normalizer-controls.ts` goes through `parseRecordedToolArguments` (four call sites), so the file has one rule, "records are read with the recorded parser", and the next retirement in any tool has one place to go. It beat switching only the two `show_pane` sites, which leaves a file that uses two parsers for one purpose.

**A call that names the pane is refused, and told what to do instead.** The host answers `TOOL_ERRORS.artifactPaneRetired` (Interfaces §A) and asks no window. **Decision 17** [design]: `parseToolArguments` gives that answer first, whenever the call is `show_pane` and its `pane` is exactly `artifact`, whatever else the arguments hold (an `at`, a `line`, an unknown key): an agent that names the retired pane always reads the sentence that teaches the link, never a list of issues. The "unknown pane" refusal lists the six. This is the case of a session started before the change: it keeps the instructions it was first given, its agent still reads the old invitation, calls, and is told.

**The window refuses too** [ruled]. `showPane` in `tools/maws/panes/connect.ts` answers a `maws.pane.show` request for `artifact` with the same sentence and opens nothing, whatever engine host sent it: an engine host of an older build on this Mac, which outlives an update of the app, still lists the pane and still asks. **Decision 19** [design]: the refusal is the function's first statement, before any tool is looked up, so the answer does not depend on whether the Artifacts tool is registered; `showArtifact` and its three lookups are deleted; and `MawsPaneShowSchema` is **not** narrowed, because a request that fails the event's schema never reaches a window, and the agent would then wait out the bridge's 8 seconds and read "no MAWS window answered" in place of the sentence. The refusal is synchronous: the await this path had, the lookups, is gone with them.

**The three invitations go** (Interfaces §A): the instructions lose one sentence and are 635 characters (64 fewer; root UC-15), `artifact_create`'s description and the paragraph that closes every kind's guide lose their last clause. **Decision 20** ["Reported" 6]: the two refusals only the deleted lookups answered go with them.

**A transcript recorded before the change** reads as it did: the old call's row is "Opened Artifacts", from the stored result, which still parses, and its journal yields the events it always did. Nothing in an old transcript opens anything: `maws.pane.show` is a request to a window and is never replayed from a record.

### Routes (law 5)

The link is drawn from the transcript's text by one component, so its look and its click are the same for a session MAWS runs, a terminal session and a session on another machine; in a session whose mod draws the agent's messages the click is the mod surface's, under the same rule (decision 6). `show_pane` exists only in a session MAWS runs, on this Mac or another; a terminal session's agent never had it. On another machine the description the agent reads is that machine's build's.

### Stored and sent, and build F (root UC-14)

Nothing stored changes shape and nothing new crosses the wire: no layout key, no settings key, no field of a stored tab, no command, no event, no field of either. The journal keeps its form; what differs is the text of three strings inside frames it already holds (the description and schema `tools/list` answers, the instructions, an error text). Interfaces §G is the table of what each build does with the other's records, and the reason no wire minor is taken and the cross-build coverage table gains no row.

### Why this, not that

The owner asked for the link to take the place of the agent's own opening. **This departs from Claude Desktop, on the owner's word** (law 1): in `app-5.1231.2` a Code session's agent has a tool that shows a pane, whose panes include a file and, when artifacts are on, an artifact (`main-process/index.chunk-BrRSHcvT.js:11769-11782`); Desktop also opens a published artifact when the publishing call asks for it (`auto_open`, `main-process/index.chunk-BjORVu2_.js:28229, 28310`) and has a setting "Auto-open files Claude writes" (`web/app/v1/c71860c77-CNJozjfF.js:1080`). What MAWS keeps from Desktop is the link's look and element and the click that opens beside the chat. One difference stood before: ⌘-click opens a main tab in MAWS and the system's app in Desktop (`web/app/v1/c856385e2-DPBwiU-E.js:2193-2199`), which has no main tab.

Removing the pane beat only withdrawing the invitation: an instruction alone still lets an agent move the person's view unasked. A refusal that teaches the link beat accepting the call and opening nothing, which would tell the agent something untrue ("shown"), and beat the plain "unknown pane", which gives an agent with old instructions nothing to act on. Keeping the full pane list for records, at both gates, beat narrowing one list: the event's and the result's schemas are strict, and with one narrowed schema a journal written last week would lose its `maws.pane.shown` events on the day of the update, as would every refusal the new build writes. Removing the whole tool lost: the owner's words name artifacts, U12 has just built on `show_pane` for the browser, and the owner chose to keep all six.

### What is not proven

- That a session keeps the instructions it was first given across a resume on the pinned engine 2.1.322 ("What the code holds today" 13). The refusal is the same either way.
- Whether a skill or a prompt of the owner's calls `show_pane` with `artifact`: not read (root UC-11). Such a call now gets the sentence that says what to do instead, and the architect tells the owner in the landing's note.
- That Chromium draws the ring of decision 10 on each line of a wrapped link as intended, and whether a swept selection included a `<button>`'s text before: neither can be read without a browser; the scene of M2 takes a picture of the first for the architect's look, and reads the second from the selection.

## Acceptance

A14 and A15 are the numbers the child's file gives this item in the spec's next batch. Each part is a behaviour someone can see or a test that fails without the change; the last column says who can run the proof.

| | The behaviour | Proof | Milestone, runner |
|---|---|---|---|
| **A14.1** | An agent's `[title](maws-artifact:<id>)` reads as a link: accent-coloured text in the prose font, no border and no ground, an underline only under the pointer. A path link reads the same in the monospace font. The image chip keeps its box, and a web link its standing underline. | Unit: the element, its role, class and attributes (`links.test.tsx`, `sanitize.test.tsx`). Scene: the computed style at rest and under the pointer (`e2e/maws-tools.spec.ts`, the link scene). | M2; unit on the VM, scene by the architect |
| **A14.2** | A title longer than the line wraps across lines as prose does and stays inside the text column. | Scene: the mention's line boxes number two or more, and its right edge is within the column's. Unit: the element is a `span`, never a `button`. A browser alone lays text out, so the scene is the proof of the wrap; the unit case is what class 1a holds. | M2; scene by the architect |
| **A14.3** | A click shows the artifact in the session's side column with the transcript in place; ⌘-click opens a main tab. | The link scene's existing steps; unit. | M2 |
| **A14.4** | With the artifact open as a main tab, a click on its mention brings that tab forward, at the link's place when it names one, and nothing opens or changes beside the chat. | Unit: `showOpenArtifactTab` over the layout store (no tab; a tab not in front; a tab in the other pane of a split; a page open in place of the tabs; a place; another machine's session; a tab of the same id on another machine not taken) and the click rule in both click sites. Scene: after the ⌘-click, back in the chat, the click selects the artifact's main tab and the side column still shows what it showed. | M2 |
| **A14.5** | Tab reaches the link; Enter and Space open it as a click does; ⌘Enter opens a main tab; Space does not scroll the transcript; a held key opens once; a key that an earlier listener consumed (an app chord bound to it) opens nothing. Under a mod's surface the key opens for the surface's session. | Unit: `keyDown` of each key calls what the click calls and returns default-prevented; a repeat calls nothing; with a capture-phase listener on the window that prevents the key's default the key opens nothing, and the same key with no such listener opens; the mod surface's case. Scene: focus the mention, press Enter, the artifact shows beside the chat. | M2 |
| **A14.6** | Dragging across part of a link's text selects it and opens nothing; a swept selection of the passage holds the link's text. | Scene: a pointer drag inside the mention leaves a selection that is not empty and the side column unchanged; the selection of the whole row contains the title. | M2; by the architect |
| **A14.7** | `tools/list` describes `show_pane` with six panes and no `at`. A call that names `artifact` asks no window, opens nothing and is answered with the sentence; its row reads "Could not open pane: MAWS no longer opens an artifact for the user. Name it in your message as a Markdown link, [its title](maws-artifact:<artifactId>), and the user opens it with a click." | Unit: `tools.test.ts`, `show-pane.test.ts`, `session-maws.test.ts` (the live events equal the events rebuilt from the journal), the model's row label (`transcript/model/maws.test.ts`). Scenes under replay: the host's answer in the journal, the event, and nothing opened, also when the target names an artifact that exists (`e2e/deliverables.spec.ts`, `e2e/maws-tools.spec.ts`). The row's words end to end: the paid live group. | M1; live group by the architect, once |
| **A14.8** | A window refuses a `maws.pane.show` request for the artifact pane from an older engine host: it answers the sentence, opens nothing and reads nothing. | Unit: `connect.test.ts`, a request in build F's form with a target and an `at`; the answer, no tab added, and none of `artifacts.get`, `artifacts.list`, `session.get` invoked. | M1 |
| **A14.9** | A transcript recorded before the change reads "Opened Artifacts" for its old call. | Unit: the model's row label for a stored result of the artifact pane; A15's journal cases. | M1 |
| **A15.1** | (No visible face.) `src/shared/maws/tools.test.ts` fails before and passes after: the description word for word, the six-pane input without `at`, the recorded schema with `at`, the refusal word for word and where it takes precedence, the unknown-pane list, `artifact_create`'s ending; with it `search-tools.test.ts` (the instructions word for word and 635 long), `instructions.test.ts` (the joined length 980) and `guides.test.ts` (the closing paragraph, and no guide naming `show_pane`). | The four files on the VM. | M1 |
| **A15.2** | (No visible face.) `src/engine-host/normalizer.test.ts`: three synthetic journals are each normalised and the **whole list of events** is compared with the expected list, `tool.use`, `tool.result` and `maws.pane.shown` included: build F's form answered "shown" (a call for the artifact pane with a target and an `at`), build F's form answered with an error, and this build's form answered with the refusal. A fourth pair shows what yields no pane event. These hold before and after the change and fail under a build with one narrowed schema, at either gate ("Reported" 3). | The file on the VM, with the red of M1's second step recorded. | M1 |
| **A15.3** | (No visible face.) The probe's snapshot is still the source as the fixtures were served it, and the fixtures still match the snapshot. | `search-tools.test.ts` (decision 21) and `pnpm test:probes`. | M1 |
| **A16** | The whole tree is green: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:probes` and the gate's script tests, apart from the files the build brief lists as failing on master on the VM too. | Concrete Steps 7. | M2 |

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the wave's build VM in a checkout of the pushed head, through `vmcheck.sh` (Concrete Steps), each under a time limit. The VM is shared with another landing's build: a slow or timed-out check is read against its load first. An executor starts no Electron e2e, runs no `scripts/ci-gate.sh`, opens no pull request and runs no engine. Every commit message ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution. The branch takes master by merge, never by rebase or force-push.
2. **The owner's words and the rulings bind** (Decision Log 1 to 3): the look, "Show that tab", all six panes, the `span` with `role="button"`, the two schemas with the recorded one at both of the normaliser's gates, the window's refusal, and the charter's sentence as worded. An executor that finds one of them cannot be built as written stops and reports.
3. **The texts are exact** (charter X9; root UC-15). Every string of Interfaces §A is built character for character and pinned by a test that compares the whole string. The instructions' budget: 635 characters after this landing, 64 fewer.
4. **Records are read as before.** `PANE_NAMES`, `PaneSchema`, `ShowPaneResultSchema`, `ShowPaneOpenedSchema`, the event `maws.pane.shown` and `MawsPaneShowSchema` are not edited. No file under `src/shared/ipc/` or `src/shared/graph/` changes; if a check of the wire's fingerprint moves, something crossed the wire that this design says does not: stop and report (a wire minor would then be one commit of its own, by the architect's ruling).
5. **Stored and sent** (root UC-14): Interfaces §G. No stored key, no settings change, no row in the cross-build coverage table.
6. **Files other children own** (root UC-8): Interfaces §I lists every edit outside U6's own files, with its owner. An executor that needs another stops and reports.
7. **The repository is public** (root UC-11). Tests and scenes use invented titles, ids and paths. Nothing of the owner's is written anywhere, and no fault is reproduced by reading the content of a session, a journal, a settings file or a document of a person's: structure and counts only.
8. **The wave's laws.** Law 1: the look and the element are Claude Desktop's; the tool's removal departs from it on the owner's word, said in the design. Law 3: no setting, no new element on screen. Law 6: no engine fact is assumed beyond "What the code holds today" 13; one the fixtures do not hold goes to the architect. Law 7: existing tokens only (decision 14).
9. **Guards that read source text.** In renderer source and its tests an item or ticket number is written in words: the tokens guard (`test/support/tokens-guard.test.ts`) reads `#` and three to eight hex digits as a colour, at a word's end. The link fragments the tests write (`#block=b7`, `#tab=t2`, `#v3`) pass because none begins with three hex digits; a new one is checked by running the guard. Run that guard with M2. A scene must not write `expect(<a name ending in At or Ms>).toBeLessThan(…)`; the scene of M2 names its counts `lineBoxes` and the like.
10. **If a command fails with "No space left on device"**, stop, tell the architect, and delete nothing.

## Plan of Work

Two milestones. They share no interface: M1 is the tool and its records, M2 the link in the window. They run in this order because both edit `e2e/maws-tools.spec.ts` (different scenes) and M2 ends with the landing's acceptance run.

### M1 — The agent opens no artifact: the texts, the two schemas, the refusal at the host and at the window, and old journals

**What exists at its end.** `tools/list` describes `show_pane` with six panes and no `at`; a call for the artifact pane is refused by the engine host with the sentence and reaches no window; a window refuses the same request from an older host and reads nothing; the instructions, `artifact_create` and the guides no longer invite the call; a journal in build F's form and a journal holding the new refusal both normalise to the events of Interfaces §C; the charter records the amendment.

**What it touches.** `src/shared/maws/panes.ts`, `tools.ts`, `instructions.ts`; `src/artifacts/types/guides.ts`; `src/engine-host/tool-server/show-pane.ts` and `panes.ts` (the host's request type loses `at`); `src/engine-host/normalizer-controls.ts`; `src/renderer/src/tools/maws/panes/connect.ts`; the header comments of `src/shared/maws/artifact-scope.ts` and `src/services/sessions/artifact-scope.ts`, which name the window's lookup as a caller. Tests: `src/shared/maws/tools.test.ts`, `search-tools.test.ts`, `instructions.test.ts`; `src/artifacts/types/guides.test.ts`; `src/engine-host/tool-server/show-pane.test.ts`; `src/engine-host/normalizer.test.ts`; `src/engine-host/session-maws.test.ts`; `src/renderer/src/tools/maws/panes/connect.test.ts`; `src/renderer/src/transcript/model/maws.test.ts`; `test/live/maws-tools.live.test.ts`. The probe's snapshot, one string: `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json`. Scenes: `e2e/maws-tools.spec.ts` (the `show_pane` scene), `e2e/deliverables.spec.ts` (its `show_pane` scene), `e2e/maws-tools-live.spec.ts` (step 4). Records: `docs/charter.md`, `docs/tech-debt-tracker.md`, this document's Progress.

**Interfaces.** Exposes §A's texts, §B's names and §D's refusal. Consumes nothing of M2.

**Decisions that are this milestone's.**

- **The order of work, so that the red is seen (decision 24).** (1) Add A15.2's journal cases to `normalizer.test.ts` and run the file: they pass on today's code. That run shows the cases are sound before anything changes; it is not offered as a run of build F, whose reading of this landing's forms is taken from F's source (Interfaces §C). (2) Narrow the input schema and add the refusal in `tools.ts`, with `tools.test.ts` rewritten: the journal cases now fail, each for a missing `maws.pane.shown`. Quote the failing cases' names in the hand-back. (3) Add `parseRecordedToolArguments` and switch the normaliser: green. A build in which step 2 does not turn the journal cases red has not narrowed the schema the normaliser reads, and the cases are then proving nothing: stop and find out why.
- **Each gate is covered.** With only the admission switched, `mapMawsAnswer` drops the event; with only the read switched, the call is never admitted. The same cases fail in both, so they hold both gates; say in the report that each half was tried.
- **Decision 21, the probe's snapshot** (ruled; "Reported" 1). `p4-maws-tools.json` is not regenerated (`MAWS_WRITE_PROBE_TOOLS=1` would drop the retired `message` tool that two tests require) and its `instructions` and `show_pane` entry are not touched: they stay as served when the P4 fixtures were recorded, and `fixtures.test.mjs` compares the fixtures with them. Only `artifact_create`'s `description` is replaced by hand with the new one. In `search-tools.test.ts` the snapshot's case keeps its form (the snapshot's one tool the source lacks is `message`; everything else equals the source) and gains a short named list of the places where the snapshot is older than the source, which the comparison reads. Each entry is data with its date and its reason, not a reversal written into the assertion. Two entries: (1) `instructions`, 2026-11-14, O-44 took the sentence out of the source: the snapshot still holds "Call mcp__maws__show_pane only when the user should see it now. " before "To find an artifact you did not make…"; (2) the `show_pane` entry, 2026-11-14, O-44 retired the `artifact` pane and `at`: the snapshot still holds the description of before this landing and an input schema equal to `z.toJSONSchema(ShowPaneRecordedInputSchema)`. Outside the list the comparison is whole, so a difference nobody named still fails. An entry leaves the list when the P4-B4 and P4-A3 scenarios are recorded again, at the next probe pass that touches them. It beat editing the snapshot and moving "as recorded" literals into `fixtures.test.mjs`, which would make the probe's test assert against text the probe never served.
- **Decision 22, the replayed scenes** ("Reported" 2). In `e2e/maws-tools.spec.ts` the `show_pane` scene expects the second call's answer to be `TOOL_ERRORS.artifactPaneRetired` and the event list `[['terminal', 'panel-tool', null], ['artifact', null, TOOL_ERRORS.artifactPaneRetired]]`; its label assertions stand, with the comment saying why the label is the recording's. In `e2e/deliverables.spec.ts` the scene becomes one statement over its two sessions: with nothing delivered and with an artifact whose id the target names, the call is answered with the sentence, the event carries it, and no Artifacts viewer opens (the seeded half asserts the viewer's absence where it asserted the open). `e2e/maws-tools-live.spec.ts` step 4 expects the event's error to be the sentence and the cell to begin "Could not open pane: MAWS no longer opens an artifact for the user."; its prompt stands.
- **`test/live/maws-tools.live.test.ts`, case 4:** one pane request (the terminal's), the artifact call's event with the sentence as its error, and its title reworded. It is edited and typechecked and it is **not run**: a run is a live recording (`MAWS_LIVE=1`) that would record the fixture `p1-maws-show-pane` again, and no gate runs the file (ruled; "Reported" 9).
- **The window's deletion.** `showArtifact`, `artifactOf`, `artifactIn`, `ancestorsOf` and the imports only they use go from `connect.ts`, and the file's header loses the paragraph that describes them and gains two lines on the refusal. In `connect.test.ts` every case that opened or looked up an artifact goes; what stands in their place is A14.8's case, the same request without a target, and the case that the refusal does not depend on the Artifacts tool being registered. The other panes' cases are untouched. `src/shared/maws/artifact-scope.ts` stays: the services use it.
- **Comments.** In the files this milestone edits, a comment that states the old rule is corrected where it stands: the opening comment of `tools.ts` (the sentence "so the host refuses exactly the calls the normaliser declines to map (residue 1)" gains its one exception, and the file's history gains a line for this landing), the comment on `McpCall.admitted` in `normalizer-controls.ts`, the headers of `show-pane.ts`, `panes.ts` and `instructions.ts`, and the comment above `LINKED`, which says "draws as a chip". Comments in other files that name `show_pane`'s `at` beside a link's fragment as a source of a place are P4-B4's history and are left.
- **The charter and the tracker** are edited in this milestone, in a commit of their own: "The pull request" gives the sentences.

**What it does not touch.** `transcript/view/` and everything of M2. `src/shared/ipc/`, `src/shared/graph/`, `src/endpoint/`, `src/main/`. The event's and the result's schemas. `e2e/fixtures/`. The recorded fixtures under `spikes/protocol-probe/fixtures/`. The bridge's own test (`tool-server/panes.test.ts`), whose request for the artifact pane is a bridge-level value the type still admits.

**What it proves.** A14.7, A14.8, A14.9, A15.1, A15.2, A15.3. Beyond them, one line each: the host's request to a window never carries `at`; `parseRecordedToolArguments` equals `parseToolArguments` for every tool but `show_pane`; `ShowPaneResultSchema` still parses a stored `shown` answer of the artifact pane; the wire's fingerprint is unmoved.

### M2 — The mention is a link: the element, the look, the click, the scenes, and the acceptance run

**What exists at its end.** A mention and a path link are link text on a `span` with `role="button"`; they wrap, take the keyboard and the focus ring; a click opens beside the chat, or shows the main tab that already holds the artifact, in a transcript and under a mod's surface alike; a drag that selects opens nothing. The landing's acceptance run is green.

**What it touches.** `src/renderer/src/transcript/view/markdown/Link.tsx`, `transcript/view/transcript.css`, `transcript/view/context.tsx` (one optional action), `transcript/index.ts` (one export), `library/actions.ts` (`showOpenArtifactTab`), `tools/artifacts/ArtifactsTool.tsx` (the machine rule shared, if the executor places it there), `App.tsx` (the registration), `engine-surface/SurfaceTree.tsx`, `side/card/CardThread.tsx`. Tests: `transcript/view/markdown/links.test.tsx`, `sanitize.test.tsx`, `engine-surface/SurfaceTree.test.tsx`, `library/actions.test.ts`, `side/card/CardThread.test.tsx`. Scene: `e2e/maws-tools.spec.ts` (the link scene). This document's Progress.

**Interfaces.** Exposes §E's element and class and §F's two functions. Consumes nothing of M1.

**Decisions that are this milestone's.**

- **One component, one markup.** The mention and the path link are drawn by one small function inside `Link.tsx` that owns the span, the key handler and the selection test, so the two cannot drift; `TranscriptLink` passes it the attributes and the open.
- **The calls keep their argument forms.** The existing tests compare argument lists exactly (`openArtifact(session, id)` with no trailing `undefined`; `openArtifactTab(id)`, `(id, at)`, `(id, at, machine)`), and `openArtifactMention` reproduces today's branches for them. `showOpenArtifactTab` is called as `(session, id)` or `(session, id, at)`.
- **Tests that would pass for the wrong reason.** In `links.test.tsx` two cases assert that nothing clickable was drawn with `container.querySelector('button, a')`; with a span that is true of every link. They become `'button, a, [role="button"]'`. `sanitize.test.tsx` expects the mention's tag to be `BUTTON`; it becomes `SPAN` with the role asserted beside it. Interfaces §J lists every selection and what each becomes.
- **The consumed key** (decision 8). `links.test.tsx` gains one regression case: with a `keydown` listener added to the window in the capture phase that calls `preventDefault()`, Enter, Space and ⌘Enter on a focused mention call no action and dispatch no click; with the listener removed, the same keys open. The case fails on a handler that does not look at `defaultPrevented`.
- **The selection test in jsdom.** Decision 12's unit case builds a range inside the link and clicks with `detail: 1`; if jsdom's selection cannot express it, the case is dropped with a line in the report and the scene carries the proof alone.
- **The scene.** The link scene's reply gains a third mention whose invented title is about two hundred characters, placed after a few words so that it crosses a line end at the scene's window size, and the scene gains, after its existing steps: A14.1's computed style (no border, `display: inline`, no underline at rest, one under the pointer), A14.2's line boxes and right edge, A14.4 (the session's tab selected again, a click on "Linked plan", the artifact's main tab selected and the side column's record unchanged), A14.5 (focus and Enter on a mention whose artifact is not open as a main tab) and A14.6. It takes one picture of the focused, wrapped mention for the architect's look (the scene's existing `shoot`). The executor cannot run it: its proof here is the e2e project's typecheck and the gate's script tests.
- **The acceptance run** is this milestone's last step (Concrete Steps 7).

**What it does not touch.** Everything of M1. `transcript/model/`. The rows' Open buttons, `rows/Artifact.tsx`, `rows/Delivery.tsx`, `rows/User.tsx`, the read's and the edit's detail. `openArtifactInPanel`'s behaviour and `openArtifactTab`'s. `tools/code/open-file.ts`: a path link's click is today's call. `stores/layout.ts` and `layout-model.ts`, which are read through what they already export. The keymap: no action is added.

**What it proves.** A14.1 to A14.6 and A16. Beyond them: the mod surface's click and key go through the same rule; a mention where nothing can open an artifact is still its text; the tokens guard passes.

## Concrete Steps

Working directory for every command: the branch's worktree (the controller's brief names it). The VM sees only what is pushed. `vmcheck.sh` prints `vmcheck: ux-wave/U6d at <short sha>` and then the command's own output, and exits with the command's status; do not pipe it into `head` or `tail`. The first call for the branch installs dependencies and takes a few minutes. The command runs under `set -euo pipefail` there.

1. **Before each milestone:**

       git fetch origin master && git merge origin/master
       git push origin ux-wave/U6d

   A merge, never a rebase or a force-push. After a merge that brought changes, run the milestone's proof set again, not the whole suite.

2. **M1, the journal cases first** (decision 24). Commit A15.2's cases alone, push, run:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 600 pnpm exec vitest run src/engine-host/normalizer.test.ts'

   Expected: the file passes, the new cases among them. Then commit `panes.ts`, the narrowed schema, the texts and the refusal with `tools.test.ts`, push, and run the same command: expected, the three journal cases that expect a `maws.pane.shown` for the artifact pane fail, and nothing else in the file does. Keep the failing cases' names for the hand-back. Then the recorded parser and the normaliser's switch: the file passes whole.

3. **While building M1**, after each push (it changes the node project, one file of the web project and three scenes):

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 600 pnpm exec eslint <the paths changed>'

   `src/shared/` is compiled by both projects. The typecheck is what finds a remaining reader of `at` or of the two removed refusals.

4. **M1's proof.** The folders touched and the ones that read what changed (the tool table, the pane list, the normaliser, the guides, the row label), the probes, the scan for a recorded file that changed, and the gate's script tests because scenes changed:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 1500 pnpm exec vitest run src/shared/maws src/shared/ipc src/shared/graph src/artifacts/types src/engine-host/tool-server src/engine-host/normalizer.test.ts src/engine-host/session-maws.test.ts src/engine-host/conformance src/renderer/src/tools/maws src/renderer/src/transcript/model'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 600 pnpm test:probes'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   Expected: every file passes. `src/shared/ipc` passing with no generated file changed is the proof that the wire's fingerprint did not move (constraint 4); `src/engine-host/conformance` normalises every recorded fixture and is the wide check that the switch of parser changed no other tool's events.

5. **While building M2**, after each push: the web and the e2e typechecks and eslint of step 3.

6. **M2's proof.**

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 1500 pnpm exec vitest run src/renderer/src/transcript src/renderer/src/engine-surface src/renderer/src/library src/renderer/src/side/card src/renderer/src/tools/code src/renderer/src/tools/artifacts src/renderer/src/App.test.tsx test/support/tokens-guard.test.ts'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   Expected: every file passes. Before the element changes, the rewritten `links.test.tsx` and `sanitize.test.tsx` fail on the tag, the class and the keys: that is the expected red, seen once.

7. **The acceptance run** (M2's last step; A16), on the pushed head, after a last merge of master:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 1800 pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 1200 pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 3600 pnpm test'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U6d -- 'timeout 600 pnpm test:probes'

   Expected: each exits 0, apart from the files the build brief lists as failing on master on the VM too (the desk-hub deploy tests, `src/services/machine/setup.test.ts`, `src/shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`; `Sidebar.test.tsx` under the full suite's load); vitest's summary names no other failed file. Look at a background run before its limit has passed twice; a log that has stopped growing beside a process at full CPU is a loop, to be stopped and reported. Acceptance against these runs: A14.7 to A14.9 and A15 are step 4's files; the unit halves of A14.1 to A14.5 are step 6's; A16 is this step. The scenes, the live group and class 1a are the architect's.

8. **Stop and hand back.** The executor of M2 writes into Progress what ran, with each command's result, and what is left; pushes; and stops. In the hand-back: the red of step 2 with its failing cases' names quoted, the two half-switched tries, any case dropped under "The selection test in jsdom", and the decisions made.

## Interfaces and Dependencies

### §A. The texts (M1 and M2), exact

Each is compared whole by a test. Lengths are in characters.

- **`show_pane`'s description** (416; it was 577):

      Open a MAWS pane for the user: "diff", "file", "terminal", "tasks", "browser" or "source-control"; without this tool, describe where the user should look. target names what to open: a file path for diff or file (line optional), a URL for browser (a page already open is reloaded, unless the user is using that tab). Returns what was opened, or an error for an unknown pane or a pane this build of MAWS does not have.

- **`TOOL_ERRORS.artifactPaneRetired`** (178), a constant, new:

      show_pane: MAWS no longer opens an artifact for the user. Name it in your message as a Markdown link, [its title](maws-artifact:<artifactId>), and the user opens it with a click.

- **`TOOL_ERRORS.unknownPane('nope')`**, over `AGENT_PANE_NAMES`:

      show_pane: unknown pane "nope"; known panes: diff, file, terminal, tasks, browser, source-control

- **`MAWS_SERVER_INSTRUCTIONS`** (635; it was 699): today's paragraph without the sentence "Call mcp__maws__show_pane only when the user should see it now. " (with its trailing space), so that it reads "…with the ids mcp__maws__artifact_read and mcp__maws__artifact_search return. To find an artifact you did not make or open in this session, call mcp__maws__artifact_search." With the browser paragraph the whole is 980 (it was 1,044). The tools it names are `artifact_read` and `artifact_search`.
- **`artifact_create`'s description** (1,275; it was 1,328): today's with its ending "…: a click opens it in MAWS; call show_pane only when the user should see it now." replaced by "…: a click opens it in MAWS."
- **The paragraph `LINKED` appends to every kind's guide:** a blank line, then "When a message to the user names this artifact, write it as a Markdown link, [its title](maws-artifact:<artifactId>): the user opens it in MAWS with a click." and a newline. The sentence "Call show_pane only when the user should see it now." goes.
- **`ARTIFACT_LINK_TITLE`**, the mention's tooltip (in `Link.tsx`, replacing `ARTIFACT_CHIP_TITLE`): `Opens the artifact · ⌘-click opens it in a tab`. It names no place, so it is true wherever the click lands.
- **Removed:** `TOOL_ERRORS.artifactNotFound`, `TOOL_ERRORS.artifactUnreadable` (decision 20).

### §B. The schemas and the parsers (M1)

    // src/shared/maws/panes.ts
    export const PANE_NAMES = ['diff', 'file', 'terminal', 'tasks', 'artifact', 'browser', 'source-control'] as const; // unchanged: every pane a record can name
    export const AGENT_PANE_NAMES = ['diff', 'file', 'terminal', 'tasks', 'browser', 'source-control'] as const;       // the panes show_pane carries out
    export const AgentPaneSchema = z.enum(AGENT_PANE_NAMES);

    // src/shared/maws/tools.ts
    export const ShowPaneInputSchema          // strict: pane over AGENT_PANE_NAMES, target (≤ 4096), line (≥ 1, the file pane only). No `at`.
    export const ShowPaneRecordedInputSchema  // the schema as it stands at c7b62e48b, unchanged: pane over PANE_NAMES, target, line, at, both refinements
    export type ShowPaneRecordedInput = z.infer<typeof ShowPaneRecordedInputSchema>;
    export function parseRecordedToolArguments<N extends MawsToolName>(name: N, args: unknown):
      | { ok: true; data: N extends 'show_pane' ? ShowPaneRecordedInput : ToolInput<N> }
      | { ok: false; error: string };

- `MAWS_TOOLS.show_pane.input` is `ShowPaneInputSchema`, so `tools/list` answers its JSON schema: `pane` an enum of the six, `target`, `line`, `required: ['pane']`, no `at`, no additional properties.
- `parseToolArguments('show_pane', args)`: when `args.pane` is exactly the string `artifact`, the answer is `{ ok: false, error: TOOL_ERRORS.artifactPaneRetired }`, before the schema is consulted (decision 17). Otherwise as today: a pane the six do not hold is `unknownPane`; anything else (an `at` on another pane is now an unknown key) is `invalidArguments` with the issues.
- `parseRecordedToolArguments`: for `show_pane`, the recorded schema decides; a refusal carries `TOOL_ERRORS.invalidArguments('show_pane', <issues>)`, which no caller reads. For every other tool it is `parseToolArguments`. Its only caller is the normaliser; the host's tools keep `parseToolArguments`.
- The host's `PaneShowRequest` (`tool-server/panes.ts`) loses `at`; `MawsPaneShowSchema` keeps it (decision 19).

### §C. What the normaliser emits (M1)

For each form a journal can hold. "The call's rows" are its `tool.use` and `tool.result`, which every row below has.

| The journal's call and answer | Events on this build |
|---|---|
| written by an earlier build: `{pane: 'artifact', target, at?}` answered `{status: 'shown', pane: 'artifact', opened: {kind: 'panel-tool', toolId: 'artifacts', …}}` | the call's rows and `maws.pane.shown {pane: 'artifact', target, opened: {…}, error: null}`: what that build emitted |
| written by an earlier build: the same call answered with an error (no such artifact; no window answered) | the call's rows and `maws.pane.shown {pane: 'artifact', target, opened: null, error: <the text>}`, as that build |
| written by this build: `{pane: 'artifact', target?, at?}` answered with `artifactPaneRetired` | the call's rows and `maws.pane.shown {pane: 'artifact', target, opened: null, error: <the sentence>}` |
| written by this build: the retired pane with arguments the recorded schema refuses (a `line`, an unknown key), answered with the sentence | the call's rows only |
| either: a pane neither list holds, or `at` on another pane | the call's rows only, as today |
| any other pane, any other tool | as today |

**What build F does with these forms** is claimed only for the two forms this landing writes, the table's third and fourth rows, and it is a reading of F's source (`git show f1852de3a:<path>`), not a run on F's code. F's one argument schema is today's recorded schema: it admits the artifact pane with a target and an `at`, and refuses a `line` or an unknown key on it. So F admits the third row's call and not the fourth's, as this build does. The answer in both rows is an error, and for an error F's `mapMawsAnswer` takes the answer's text as the event's error and never reads what its result parser made of it (the parsed JSON is null for an error, and the guard is `!args.ok || (!isError && !parsed.success)`; `normalizer-controls.ts` is byte for byte F's). F therefore emits the third row's `maws.pane.shown` with the sentence as its error, and nothing for the fourth. Other panes' journals across builds are outside this landing and unchanged by it: F's `ShowPaneResultSchema` is a strict object of `status`, `pane` and `opened`, while today's also admits `page` and `note`, so what F makes of another pane's answer written by a later build is what it was before this landing.

### §D. The window's refusal (M1)

`showPane(request)` in `tools/maws/panes/connect.ts`: for `request.pane === 'artifact'` it returns `{ ok: false, error: TOOL_ERRORS.artifactPaneRetired }` synchronously, as its first statement, whatever the target and `at`. It adds no tab, selects none and invokes no command. `connectPaneShows` relays that answer through `maws.pane.answer` as it relays any refusal.

### §E. The link element (M2)

    <span role="button" tabindex="0" class="transcript-inline-link"
          data-chip="artifact" data-artifact-id="<id>" data-artifact-at="<the fragment, when the link names a place>"
          title="<ARTIFACT_LINK_TITLE>">…the link's children…</span>

    <span role="button" tabindex="0" class="transcript-inline-link" data-chip="path" title="<the path>">…</span>

The style, in `transcript/view/transcript.css`, by its effect (the executor writes the rules; tokens only):

- No `display` is declared: the element is inline, so it wraps with the text. `overflow-wrap: anywhere`, as the chip had, so an unbroken title cannot leave the column.
- At rest: `color: var(--accent)`, no underline, `cursor: pointer`. Font and size are inherited; `[data-chip="path"]` adds `font-family: var(--font-mono)` and `font-size: 0.9em`.
- Under the pointer: `text-decoration: underline` with `text-underline-offset: 2px`.
- With keyboard focus (`:focus-visible`): `outline: none`, a 2 px ring in `var(--accent)` drawn with `box-shadow`, `border-radius: var(--radius-sm)`, and `box-decoration-break: clone` with its `-webkit-` form on the element.
- Nothing for pressed, nothing for visited.

The handlers:

- `onClick`: unless the click ends a selection (below), call the open with the event's `metaKey`.
- `onKeyDown`: when `event.defaultPrevented` is already true, return at once, before anything else: no `preventDefault()` of its own and no click (decision 8). Otherwise, for `Enter` or a space, when `event.repeat` is false: `preventDefault()`, then dispatch on the element a `MouseEvent('click', { bubbles: true, cancelable: true, metaKey: event.metaKey })`. For a repeat of either key: `preventDefault()` only.
- A click ends a selection when `event.detail > 0`, the document's selection is not collapsed, and it contains or intersects the element. `endsSelection(event, element)` is exported beside the component for the mod surface's handler.

### §F. The click rule (M2)

    // transcript/view/context.tsx, on TranscriptActions
    // UX wave U6d: the main tab that already shows this artifact, brought forward at `location`; false, and nothing done, when the strip holds none.
    showOpenArtifactTab?(appSessionId: AppSessionId, artifactId: string, location?: ArtifactLocation): boolean;

    // library/actions.ts, registered in App.tsx beside openArtifact and openArtifactTab
    export function showOpenArtifactTab(appSessionId: AppSessionId, artifactId: string, location?: ArtifactLocation): boolean;

    // transcript/view/markdown/Link.tsx, exported through transcript/index.ts
    export function openArtifactMention(actions: TranscriptActions, session: AppSessionId | null, link: { artifactId: string; at?: ArtifactLocation }, metaKey: boolean): void;

`showOpenArtifactTab` works out the machine as `openArtifactInPanel` does (the session's machine when it is another machine, else `artifactMachineOf(artifactId)`, else this Mac), through one function both use; looks for `tabId({ kind: 'artifact', artifactId, machine })` in `useLayout.getState().main`; when the strip holds it, calls `openArtifactTab(artifactId, location, machine)` and answers true; else does nothing and answers false. It reads no other store and awaits nothing.

`openArtifactMention`, the one rule for both click sites:

| The case | What is called |
|---|---|
| no session (a Markdown surface outside any transcript) | `openArtifactTab`, as today |
| ⌘ held, and the mount has `openArtifactTab` | `openArtifactTab`, with the session's machine when the session's id is an address, as today |
| otherwise, and `actions.showOpenArtifactTab?.(session, artifactId[, at])` answers true | nothing more: the main tab is shown |
| otherwise | `actions.openArtifact(session, artifactId[, undefined, at])`, as today |

`TranscriptLink` calls it with its context's actions and the row's session; `MarkdownNode` in `engine-surface/SurfaceTree.tsx` calls it with the registered actions and the surface's session, after `endsSelection`. The comment card's thread (`useCardActions`) answers false from `showOpenArtifactTab` for the artifact its page shows and defers to the registered one for any other (decision 7).

### §G. Stored and sent, and what build F does (root UC-14)

| What | This build writes | Build F (`f1852de3a`) meeting it | This build meeting what F wrote | This build, then F, then this build |
|---|---|---|---|---|
| The journal's frames of a `show_pane` call for the artifact pane | the call as the engine sent it; the host's answer, an error with the sentence | by a reading of F's source (§C): F's schema admits the call and the answer's text becomes the event's error, so F emits `maws.pane.shown` with the sentence; F's row reads "Could not open pane: MAWS no longer opens an artifact for the user. …" through its own `paneLabel` | F's call and "shown" answer are admitted through the recorded schema and yield F's events; the row reads "Opened Artifacts" | each build reads the whole journal by the rules above; nothing is rewritten |
| The journal's `tools/list` and `initialize` answers | six panes, no `at`; 635 characters | not read back by any build; the engine asks again at each launch, so a session F resumes is served F's list and its agent can open an artifact again while F runs, which is F's behaviour | the reverse: a session this build resumes is served the six | — |
| `maws.pane.show`, the host's request to a window | never for the artifact pane, never with `at` | F's window is not asked | F's host (an older engine host on this Mac during an update) asks with `pane: 'artifact'` and perhaps `at`; the request validates, and this build's window refuses with the sentence, which F's host hands the agent | — |
| `maws.pane.answer` | an existing shape; the error string is the sentence | F's host relays any error string | — | — |
| A mention in a transcript | not stored by MAWS; the grammar `maws-artifact:<id>[#…]` is unchanged | F draws it as its chip | drawn as the link | — |
| Layout, settings | nothing | — | — | — |

So (decision 23) no wire minor is taken, neither settings file changes, and the cross-build coverage table (begun in U13a's execution document, M5) gains no row and no scene: no stored key is added and no key F reads is relied on. Of the two cross-build facts, F's reading of the artifact-call forms this build writes is a reading of F's source (§C), and this build's window against F's host is unit-proven by A14.8. Other panes' cross-build behaviour is outside this landing and unchanged by it.

### §H. What this landing consumes, and what a sibling may rely on

**Consumed, by the name it is exposed under.** U13a's one strip: `useLayout.getState().main`, `isOpen` (`stores/layout-model.ts`), `tabId` for kind `artifact`, and that showing a tab closes an open page. U8b's side column: reached only through `openArtifactInPanel`, unchanged. U7b's `asked: 'agent'` calls in `connect.ts`: the artifact branch's call is deleted with the branch; the others stand. U12a's `show_pane`: the reload clause of the description, the result's `page` and `note`, the `browser` pane's path through `connect.ts`, all kept. U9: `isAddress` and `machineOf` for a session's machine. U6a's keymap: no action id is added, so nothing about rebinding arises.

**For siblings.**

- **U6b** (a file beside the chat; `file://` and relative links): its two edits in the Markdown link code land on the span of §E. A path link's click is still `actions.openFile(path, line, session)`; its selector is `[data-chip="path"]`; its class is `transcript-inline-link`.
- **U6's preview landing** (l6-artifacts-01): the view a mention's click opens is the side column's Artifacts tab, or the main tab by §F; `show_pane` for `file` stays, by the owner's answer.
- **U12, ticket 435** (a pane asked for on another machine, shown here): at this head no code relays another machine's `maws.pane.show` to a window. The refusal is the first statement of the window's `showPane` (§D), so a relayed request meets it too, and that landing adds the case to its tests.
- **U3b** (find): the link's text is in the model's rows as before; the element is a span whose text is selectable.
- **U10** (the Artifact row's third action): the row and its Open are untouched.
- **Anyone adding a pane:** a new pane goes into both `PANE_NAMES` and `AGENT_PANE_NAMES`; a retired one leaves `AGENT_PANE_NAMES` only.

### §I. Files other children own, or several landings edit (root UC-8)

| File | Owner by the root's table | This landing's edit |
|---|---|---|
| `src/shared/maws/tools.ts`, `instructions.ts` | per UC-15 (the architect) | §A and §B; a dated X9 change |
| `src/shared/maws/panes.ts`, `artifact-scope.ts` | no row | two exports; a comment |
| `src/artifacts/types/guides.ts` and its test | U10 | one clause removed from `LINKED`; the test pins the paragraph |
| `src/engine-host/tool-server/show-pane.ts`, `panes.ts` and their tests | U10, with U12's insertions in `panes.ts` | `at` removed from the host's call and request type; comments |
| `src/engine-host/normalizer-controls.ts`, `normalizer.test.ts`, `session-maws.test.ts` | no row (U3, U2 and U4 insert in `normalizer.ts`, another file) | four call sites; one comment; test cases |
| `src/renderer/src/tools/maws/panes/connect.ts` and its test | no child; U7b's insertion | the refusal; the artifact branch and its lookups deleted |
| `src/services/sessions/artifact-scope.ts` | no child | a comment |
| `src/renderer/src/transcript/view/markdown/Link.tsx`, `transcript/view/transcript.css`, `transcript/view/context.tsx`, `transcript/index.ts` and the two Markdown tests | per UC-3 (U3 owns the message rows; U6's two edits in the link code are named in the child's file) | §E and §F: the element, one class, one optional action, one export |
| `src/renderer/src/transcript/model/maws.test.ts` | per UC-3 | two cases of the row's label; no model code changes |
| `src/renderer/src/library/actions.ts` and its test | U10 | `showOpenArtifactTab` |
| `src/renderer/src/tools/artifacts/ArtifactsTool.tsx` | no row | the machine rule of `openArtifactInPanel` as one function `showOpenArtifactTab` also calls; no behaviour changes |
| `src/renderer/src/side/card/CardThread.tsx` and its test | U5 | one member of the card's actions (decision 7) |
| `src/renderer/src/engine-surface/SurfaceTree.tsx` and its test | no row | the capture handler calls §F's rule |
| `src/renderer/src/App.tsx` | no row | one member in an existing registration |
| `e2e/maws-tools.spec.ts`, `e2e/deliverables.spec.ts`, `e2e/maws-tools-live.spec.ts`, `test/live/maws-tools.live.test.ts` | no row | scenes' expectations; one scene's new steps |
| `spikes/protocol-probe/scenarios/pass3/p4-maws-tools.json` | no row | one string (decision 21) |
| `docs/charter.md`, `docs/tech-debt-tracker.md` | the record | "The pull request" |

Whoever lands second in a file another landing also edits merges master first (UC-8). At this head no open landing of the wave is known to edit the files of the first eight rows; U6b will edit the link code after this.

### §J. Every selection of the chip, and what it becomes

No test, scene or surface selects the mention or the path link by the class `transcript-chip`; the class's other users are the chips that keep it.

| Where | How it selects today | After |
|---|---|---|
| `transcript/view/markdown/links.test.tsx` | `getByRole('button', { name })` for mentions and path links; `[data-chip="artifact"]` for `data-artifact-at`; twice `container.querySelector('button, a')` expecting nothing | the role queries stand, since the span states the role; the two "nothing" checks become `'button, a, [role="button"]'`; new cases for the tag, the class, the keys, `showOpenArtifactTab` and the title |
| `transcript/view/markdown/sanitize.test.tsx` | `[data-chip="artifact"]` with `tagName` `BUTTON`; `[data-chip="path"]` by title | `SPAN` and the role; the path case stands |
| `App.test.tsx` | `getByRole('button', { name: 'the plan' })`, then `data-chip` | stands |
| `engine-surface/SurfaceTree.test.tsx` | `getByRole('button', { name })`, click | stands; gains the key and the open-main-tab cases |
| `tools/code/named-links.test.tsx`, `transcript/shell.test.tsx`, `transcript/view/TranscriptSlot.test.tsx` | `[data-chip="path"]`, `fireEvent.click` | stand |
| `tools/code/viewer/viewer.test.tsx` | a path link by its title; the toggle "Source" by role beside a path link also named "Source" | stands: both were buttons by role before and are after |
| `tools/agents/subagents/subagents.test.tsx` | a path link in a child's transcript, reached through the registered `openFile` | stands |
| `e2e/maws-tools.spec.ts` | `[data-chip="artifact"]` filtered by text; `a[href^="maws-artifact:"]` expecting none | stand; the scene gains M2's steps |
| `e2e/sessions.spec.ts` | `[data-chip="path"][title="…"]` | stands |
| `engine-surface/SurfaceTree.tsx` (a mod's surface) | `closest('[data-chip="artifact"]')`, `dataset.artifactId`, `dataset.artifactAt` | stands; the handler's body becomes §F's call |
| `side/card/CommentCard.tsx` | ignores clicks inside `button, a, …, [role="button"]` | already lists the role |
| `keymap/dispatcher.ts` | `isButtonOrLink`: `button, a[href], [role="button"], [role="link"]` | already lists the role |
| `transcript/view/Transcript.tsx`, a jump's focus | a cell's first `button` | unaffected: a cell's first button is its own disclosure, and a link inside a cell stops being a candidate |
| `engine-surface/focus.ts` | `button, input, select` inside a mod's own control nodes | unaffected: Markdown is not one of those nodes |
| `transcript/view/transcript.css` | `button.transcript-chip:hover`; `.transcript button:focus-visible, .transcript a:focus-visible` | neither matches the link any longer; §E's rules take their place |

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The scenes, alone, then their groups**, on a Mac under the load rule, from the branch's final head. Alone first: in `e2e/maws-tools.spec.ts` the `show_pane` scene and the link scene (the reworked one: A14.1 to A14.6, with its picture of the focused, wrapped mention); in `e2e/deliverables.spec.ts` the `show_pane` scene. Then the groups whose scenes cross the code: `e2e:tools` and `e2e:deliverables` (changed scenes), the default `e2e` group (`e2e/sessions.spec.ts` clicks a path link; every transcript scene draws the Markdown link code) and `e2e:browser` (its `show_pane` scenes go through the window's `showPane`). Needs: the built app; nothing of the owner's.
2. **The paid live group, once**, on the final head: `pnpm e2e:tools-live` (`e2e/maws-tools-live.spec.ts`; its script caps the spend). Its step 4 is the one end-to-end proof that a real engine's call for the artifact pane reaches the host, is answered with the sentence, opens nothing, and reads as the row of A14.7. The landing changed that group's scene, so the run is within the owner's answer "Once per landing" (root UC-10).
3. **`test/live/maws-tools.live.test.ts`, case 4** is edited to the refusal and typechecked, and it is unrun. The reason: running it is a live recording (`MAWS_LIVE=1`) that would record the fixture `p1-maws-show-pane` again. No run is arranged for this landing, and nothing in it waits for one.
4. **Class 1a**, once, when the branch is complete: `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u6d`.
5. **The branch review**: the xhigh panel, run from the architect's session, with the lenses of "Size and review" (Decision Log 6).
6. **No cross-build run is required** for this landing (Interfaces §G): the cross-build group's scenes are not changed and no key is added. If the architect wants the pairing seen on real builds, the one that says something is this build's app attached to build F's engine host, with the agent calling the artifact pane; it needs an engine and is a live turn, not a replay.
7. **The owner's look.** No drawn example is needed before this is built: the owner chose the look from one, and what this document settles beyond it changes nothing drawn at rest or under the pointer. The one thing the drawing did not show is the keyboard's focus ring on a wrapped link, which the scene pictures for the architect. In the sitting's scene script: A14.1 to A14.5, and a session recorded before the change reading "Opened Artifacts".

## The pull request

Its body names its class 1a run, the review's verdict with what was dismissed or deferred, the paid live group's run, and its residue. It carries, dated, the ruling this landing reverses where it stands (root UC-10, "The record"; root UC-15):

- **`docs/charter.md`, §13, at the end of the X9 paragraph**, after the dated lines of U12 and U5a: "Amended 2026-11-14 (UX wave, O-44; the owner's answer of that date, 'agent's artifact mention opens in the side panel'): `show_pane` no longer takes the `artifact` pane or `at`; an artifact is opened by the person, from the link the agent writes. A call that names the pane is refused with a sentence that says so, and is still recorded as a pane call with that error. The instructions, `artifact_create`'s description and the kinds' guides lose their invitation to call it. Records keep the pane's name, so earlier transcripts and journals read as before."
- **`docs/charter.md`, §19 (Decision log), one entry**, in that section's form: "2026-11-14 (owner; UX wave U6d, O-44; `docs/doperpowers/plans/2026-11-14-ux-wave-U6d-artifact-link.md`): X9 is amended." followed by the same words, from "`show_pane` no longer takes" to "read as before.", and the place of the dated line (§13's X9 paragraph).
- **`docs/tech-debt-tracker.md`, the row of 2026-10-27 (P4-R7z, the probe's served snapshot)** gains one clause: since this landing the snapshot's instructions and its `show_pane` entry are also older than the source, by O-44's amendment, because the recorded fixtures are compared with both; `search-tools.test.ts` names the two differences, dated, and pins the rest; the two scenarios (P4-B4 and P4-A3) are recorded again at the next probe pass that touches them, which is the row's exit.
- **`docs/tech-debt-tracker.md`, one new row**, dated 2026-11-14, owned by the visual renewal: `--accent` as text on the light theme's ground (`--bg`) is about 3.65 to 1, under 4.5 to 1, for an artifact mention and a path link (which have no standing underline) and for every web link; evidence, `src/renderer/src/styles/tokens.css` and the two rules in `transcript/view/transcript.css`; it closes when the renewal sets a link colour that meets 4.5 to 1 or records the choice. No value changes in this landing.

The tracker row about WebRTC in an HTML artifact's frame, named in the same draft, belongs to the preview landing.

What the pull request tells the owner, beyond the look and the click: a skill or a prompt that tells an agent to call `show_pane` for an artifact now gets the sentence that says to write the link instead (whether any of the owner's does was not read); a link to a file looks like the mention, in the monospace font; dragging across a link's words selects them and opens nothing; and a session started before the update may try the old call once and be told.

Records that state the old rule and follow in the architect's batch, none of them this pull request's: the child's file (its Purpose, Edges, Waiting, the acceptance A14 and A15, "Rulings reversed"; and under Waiting the sentence "everything that opens on a click reads alike", which the architect rewords to the two forms in the agent's text) and the root (U6's summary, UC-15's list of known changes, the open-questions paragraph, the Decision Log's line "Waiting on an answer and so not yet reversed: O-44 against X9"); the register's rows for O-44, at landing.

## Size and review

Counted from the code at `c7b62e48b`, per milestone. Lines are changed lines, additions and deletions together.

| | Files | Lines | Of which |
|---|---|---|---|
| **M1** | about 26 | about 850 | source 10 files, about 60 added and 110 removed (the window's lookups are 75 of the removed); tests 10 files, about 220 added and 300 removed (230 of them the artifact-pane cases of `connect.test.ts`); 3 scenes, 1 snapshot string, 2 records |
| **M2** | about 15 | about 400 | source 9 files, about 130 added and 40 removed; tests 5 files, about 170; 1 scene, about 60 |
| **The landing** | about 40 | about 1,250 (some 750 added, 500 removed) | |

The draft estimated about 17 files and 400 lines. What it did not count: the tests that pin the texts from a second side (`search-tools.test.ts`, `instructions.test.ts`, `guides.test.ts`) and the probe's snapshot ("Reported" 1); the host's session test, the model's label test and the second live test; the size of the deletion in `connect.test.ts`; everything "Show that tab" needs, which was answered after the estimate (an action, its implementation, the mod surface's handler, the comment card, their tests); the two tests that select the mention by its tag; and the records.

**The rung.** The xhigh panel of `doperpowers:review-code`, run from the architect's session, in place of the single reviewer the first writing recommended (the review's third finding, settled by the architect: Decision Log 6). About forty files is over the root's "about twenty files" mark, and the change crosses the tool's boundary with records and other builds. The one paid live run is as before. The panel's lenses:

1. **The normaliser's two gates and old journals.** Every parse in `normalizer-controls.ts` reads records with the recorded parser; a journal in build F's form and one holding the refusal yield §C's events exactly; no other tool's events moved (the conformance run).
2. **The texts**, character for character against §A, and that nothing the agent is served still invites the call.
3. **The refusal where the act runs**: at the host before any window is asked, and in the window for a request from any host; nothing is opened, read or awaited on the refused path.
4. **Compatibility and the tool boundary**: the mod surface's capture handler, the comment card's override of the action, the registration of the actions, and the schemas (the execution schema against the recorded one, `MawsPaneShowSchema` and the event's schema untouched, the wire's fingerprint unmoved, and what is claimed of build F no wider than §C words it).
5. **The renderer's interaction**: the keys (a consumed key opens nothing; a repeat; ⌘Enter), selection (a drag that selects opens nothing; the keyboard is not blocked by a selection), focus (order, the ring across a wrap), the click rule (the machine of the tab looked for is the machine the side column would have used; one function for both click sites; the unchanged cases keep their argument forms), and the wrap (no box, no `display`; the two tests that could pass for the wrong reason).
6. **The record and UC-11**: the charter's words as given; the two tracker edits; nothing of the owner's in tests, scenes or text.

## Surprises & Discoveries

- Observation: the probe's served snapshot is pinned to the source by a unit test and to the recorded fixtures by the probes' own test, and this landing changes two things both read; the two earlier edits of the snapshot (U12a's, U5a's) touched places no fixture assertion compares.
  Evidence: `src/shared/maws/search-tools.test.ts` ("the probe's snapshot of the maws server"); `spikes/protocol-probe/fixtures.test.mjs` (`served4.instructions` in "p4 R-2" and "p4 resume"; `servedPane.inputSchema.properties.at`).
- Observation: under replay a `show_pane` row's words are the recording's, not the host's answer, so no replayed scene can show the new sentence in a row.
  Evidence: `paneLabel` reads the engine's `tool_result`; the scenes' own comments in `e2e/maws-tools.spec.ts` and `e2e/deliverables.spec.ts` ("the replay compares no bodies").
- Observation: a mention under a mod's surface is clicked through a capture-phase handler of the surface, not through the link component, so a key handled only inside the component would open by another path than a click.
  Evidence: `MarkdownNode` in `src/renderer/src/engine-surface/SurfaceTree.tsx`.
- Observation: the keymap and the comment card already treat `[role="button"]` as a button, so the change of element needs no edit in either.
  Evidence: `isButtonOrLink` in `src/renderer/src/keymap/dispatcher.ts`; the click test in `src/renderer/src/side/card/CommentCard.tsx`.
- Observation: Claude Desktop's class for a file reference in a transcript is `inline box-decoration-clone text-accent hover:underline …`, and its focus ring is a box shadow, which is what `box-decoration-clone` governs; an outline is not a box decoration.
  Evidence: `web/app/v1/c86240138-zX8NMSxf.js:5-8`; `web/app/v1/c856385e2-DPBwiU-E.js:2142-2300` (`app-5.1231.2`).
- Observation: the journal cases of A15 pass on today's code. What build F does with a journal of this build is narrower than the first writing said: F's argument schema and its normaliser are today's, but F's `ShowPaneResultSchema` is strict over three keys, so the claim holds for the artifact-call forms this landing writes (an error answer, whose text F never parses) and not for every pane (the review's second finding; revision 2).
  Evidence: `git diff f1852de3a c7b62e48b -- src/engine-host/normalizer-controls.ts src/shared/maws/panes.ts` is empty; `git show f1852de3a:src/shared/maws/tools.ts`: `ShowPaneResultSchema = z.strictObject({ status, pane, opened })`.
- Observation: a key the keymap's dispatcher has taken still reaches the focused element's own `keydown` handler, with its default prevented; a handler that does not look would act a second time (the review's first finding; revision 2).
  Evidence: `dispatchKey` in `src/renderer/src/keymap/dispatcher.ts` calls `event.preventDefault()` and `binding.run`, and never `stopPropagation`; `refused` returns false for an app-scope chord with a modifier whatever the target.
- Observation: zod 4 words an unknown key with an empty path, so an `at` on another pane now reads `show_pane: invalid arguments: <root>: Unrecognized key: "at"` (before, "at: at is for the artifact pane only"); the tests pin it by pattern.
  Evidence: M1's `src/shared/maws/tools.test.ts`; the executor's report (M1).
- Observation: the window's `maws.pane.show` has a second source besides the engine host: `src/main/browser/inspect.ts` emits it. Untouched; the window's refusal is the first statement whatever the source.
  Evidence: `src/main/browser/inspect.ts` at `04deff757`.
- Observation: M1's red was seen as decision 24 orders. The journal cases passed alone on today's code (78/78); with the narrowed schema and the normaliser untouched, exactly three failed, each for the missing `maws.pane.shown` ("reads an earlier build's call for the artifact pane, with a target and an at, answered shown"; "reads an earlier build's call for the artifact pane answered with an error"; "reads this build's call for the artifact pane answered with the refusal"); with the recorded parser at both gates, green. Each half-switch (admission only, read only), tried as a transient edit on the VM, fails the same three.
  Evidence: commits `6ef9a2acd`, `63383b660`, `8bdb3164a`; the M1 report's TDD section.
- Observation: the renderer's suites run under happy-dom, not jsdom (`vitest.config.ts`, projects `renderer` and `renderer-compiled`); M2's "selection test in jsdom" ran there and needed no fallback.
  Evidence: `vitest.config.ts`; M2's `links.test.tsx` selection case, green.
- Observation: `transcript/index.test.ts` pins every runtime export of the transcript's public surface (frozen at C6's M5; its header asks for a dated Decision Log entry on a change), so §F's export turns it red; M2's list of tests did not name it.
  Evidence: `src/renderer/src/transcript/index.test.ts`, edited in `ca8f9484e`.
- Observation: `openArtifactTab` calls `revealMain()`, so "Show that tab" docks a maximized or floating side column before the main tab comes forward, as ⌘-click does today; what the column shows is untouched.
  Evidence: `src/renderer/src/library/actions.ts` (`openArtifactTab`); M2's report.
- Observation: the e2e TypeScript project has no DOM iterable lib, so an in-page `evaluate` cannot spread a `DOMRectList`.
  Evidence: `c04d96e6c`.
- Observation: M2's acceptance run on the shared VM (load 19 to 20, another branch's suite alongside): `pnpm test` named 21 failed files, the brief's known 8 and 13 load-bound timeouts in files M2 did not change; each of the 13 passed when rerun alone as the load fell. `pnpm typecheck`, `pnpm lint`, `pnpm test:probes` and the gate's script tests were green.
  Evidence: M2's report and its logs; the reading of record is class 1a.

## Decision Log

1. **2026-11-14 · The owner's words** (typed): "MAWS preview shouldn't be limited to PDF, and agent's artifact mention opens in the side panel." The second half is this landing's; the first is l6-artifacts-01's. The architect's readings, told to the owner and not contradicted: the mention is a link, a click opens the artifact in the session's side column and not in a main tab, and the agent's own ability to open an artifact pane is removed.
2. **2026-11-14 (UTC) · The owner's answers on the cards**, each the recommended option. Card C4, the link's look: "As Claude Desktop (Recommended)". Card C5, a mention of an artifact that is already open as a main tab: "Show that tab (Recommended)". Card C3, what the agent may still open: "Keep all six (Recommended)".
3. **2026-11-14 · Rulings.** The wave's architect, from the drawn example of the looks: the link is not a `<button>`; the mention and the path link are a `span` with `role="button"` and `tabindex="0"`, activated by a click, Enter and Space, with `box-decoration-break: clone` for the focus ring across a line break; the data attributes are kept. The P5 architect, approving this item as a separable landing, on four conditions: Space and Enter activate on keydown, Space prevents the scroll, and a test pins that a long title wraps; the two schemas stand, with the proofs named (A15's whole-event-list comparison on journals in build F's form, and the window's refusal of a request from an older engine host); the X9 reversal is recorded as worded, in the charter's §13 paragraph and a dated §19 line, in the landing's pull request; and the branch gets the single reviewer unless the count from the code is far above the estimate, plus the one paid live run.
4. **2026-11-14 · Verification** (the entry written at authoring). This document gets an adversarial review before an executor starts; the architect dispatches it. Each milestone is reviewed at its boundary by the controller's reviewer. The branch was to get `doperpowers:review-code` at the single-reviewer rung, `doperpowers:reviewer-high`, with the count given so that the architect could raise it; entry 6 raises it to the xhigh panel, with the lenses of "Size and review". Class 1a on GitHub Actions is the gate of record. The scenes on a Mac and the one paid live group are the architect's ("Proof that an executor does not run"). The pull request's body names its class 1a run, its review verdict and its residue, and carries the charter's two dated edits.
5. **2026-11-14 · Decisions settled at authoring.** Decisions 1 to 20 are in "The design", 21, 22 and 24 in M1, 23 in Interfaces §G, each with the alternative it beat; the eleven points of "Reported to the architect, and ruled" named the default built for each. Nothing was resolved against the owner's words or a ruling.
6. **2026-11-14 (UTC) · The architect's rulings on the adversarial review's three findings** (the review of the first writing, `064e383ba`; the architect checked each in the code).
   - Decision: **F1, accepted.** The link's `keydown` handler returns at once when `event.defaultPrevented` is true, before anything else: no `preventDefault` of its own and no synthesized click. One regression test with a capture-phase consumer on the window: the consumed key opens nothing; the same key unconsumed opens.
     Rationale: `keymap/dispatcher.ts` listens on the window in the capture phase, prevents the default and runs the binding without stopping propagation, and lets an app-scope chord with a modifier through whatever the target; a modifier-Enter or modifier-Space chord bound to an app action would run that action and also open the focused link. Rejected: the first writing's handler, which did not look.
     Where: decisions 8 and 9; Interfaces §E; A14.5; M2.
   - Decision: **F2, accepted.** What build F does is claimed only for the artifact-call forms this landing writes (Interfaces §C, the third and fourth rows), as a reading of F's source and not a run on F's code; other panes' cross-build behaviour is outside this landing and unchanged by it.
     Rationale: F's `ShowPaneResultSchema` is a strict object of `status`, `pane` and `opened`, and today's also admits `page` and `note`, so "the same events from the same rows" claimed more than was shown. For the forms this landing writes the reason holds by F's own lines: its one argument schema admits the pane, and the answer is an error text F's result parser never reads. Rejected: the wider sentence, and M1's first run as evidence of F.
     Where: "What the code holds today" 12; Interfaces §C and §G; M1's order of work.
   - Decision: **F3, settled by the architect.** The branch's review is the xhigh panel, run from the architect's session, in place of `reviewer-high`; the one paid live run as before. The lenses are the panel's, with two added: compatibility and the tool boundary; the renderer's interaction.
     Where: "Size and review"; "Proof that an executor does not run" 5.
   - Date/Author: 2026-11-14 (UTC), the wave's architect; folded in by this document's author at revision 2.
7. **2026-11-14 (UTC) · The architect's rulings on the eleven reported points.** (1) The probe's snapshot: the default stands; the `instructions` string and the `show_pane` entry stay as served; the unit test's differences are a short named list, each with a dated reason; `artifact_create`'s string is edited; the P4-R7z row gains its clause and says the two scenarios are recorded again at the next probe pass that touches them; no recording for this landing. (2) Replay cannot show the new sentence in the row: the default stands. (3) A15's order: the default stands, and the hand-back quotes the red run's failing case names. (4) "Show that tab" covers mentions only; the four other openers are listed as observed and left, and the architect tells the owner. (5) The tooltip is one string true in every case, `Opens the artifact · ⌘-click opens it in a tab`; no second string, no layout subscription; a path link's title stays its path. This replaces the draft's sentence, which the first writing had kept. (6) The two refusals with no caller left are removed, with their tests. (7) The child's sentence "everything that opens on a click reads alike" is the architect's to reword in the spec's next batch; nothing in the child's file changes here. (8) The size is accepted as counted; see entry 6, F3. (9) The second live test is edited, typechecked and not run, and the document says so and why. (10) No relay of another machine's `maws.pane.show` at this head: a note, with the sentence for the relay's landing in Interfaces §H. (11) The colour is built as chosen; the arithmetic is confirmed (about 3.65 to 1); a tracker row, owned by the visual renewal, is added in this landing's record. Everything else in the first writing stands, the 24 decisions included.
8. **2026-11-14 (UTC) · M1's decisions, folded from its executor's report.**
   - Decision: U7b's two "across the artifact's lookup" cases in `connect.test.ts` are kept, moved onto the browser's open (`browser.tabs.open`'s await), instead of going with every other artifact case. Rationale: they were the only proof that the agent origin (`asked: 'agent'`) carries across an await, which the browser path still has and nothing else in the file tested. A deviation from M1's "every case that opened or looked up an artifact goes"; accepted by the architect, 2026-11-14 (UTC).
   - Decision: the "unavailable pane from a window" cases of `show-pane.test.ts` and `session-maws.test.ts`, which used the artifact pane, now use `tasks`, with the artifact refusal added beside them.
   - Decision: A15.2's journals write build F's error and this build's sentence as literals, not `TOOL_ERRORS` references: a journal holds text, the first commit preceded the constant, and F's constant is removed. The "fourth pair" is two journals in one case, §C rows 4 and 5.
   - Decision: decision 21's named list is `OLDER_IN_SNAPSHOT` in `search-tools.test.ts`, two entries `{ place, since, reason, held }`; each place is checked against its entry, then the source's value is put in those places, `message` dropped, and the whole serialisation compared.
   - Decision: the half-switch tries were transient edits inside the VM's command, restored there, never committed. The red commit holds only `panes.ts`, `tools.ts` and `tools.test.ts`, so the red isolates the schema the normaliser reads.
   - Decision: the charter's §19 entry is placed last in §19, after the P5 closing entry; the new tracker row names M2's `.transcript-inline-link` ahead of M2, since both land in one pull request.
   - Where: M1; Interfaces §C; decision 21.
9. **2026-11-14 (UTC) · M2's decisions, folded from its executor's report.**
   - Decision: the machine rule both `openArtifactInPanel` and `showOpenArtifactTab` use is `sessionArtifactMachine` in `src/renderer/src/artifacts/machines.ts`, not in `ArtifactsTool.tsx`. Rationale: `machines.ts` is the leaf that already decides an artifact's machine; placing the rule in the panel tool would make `library/actions.ts` import that tool's module tree, which reaches `library/actions.ts` again (an import cycle). `machines.ts` is a P5 file no wave child owns.
   - Decision: `endsSelection` is exported through `transcript/index.ts` beside `openArtifactMention` (§E: the mod surface reaches the transcript only through that file), and the transcript's frozen public surface (`transcript/index.test.ts`, C6's M5) gains the two names. This entry is the dated record that file's header asks for.
   - Decision: the link's key handler reads the native event's `defaultPrevented` (the live value; the dispatcher's capture listener has run before React's root listener, so it is decision 8's test). Under a mod's surface a click that ends a selection is still prevented and stopped, and opens nothing, so the component's own handler cannot open it with the host's actions.
   - Decision: the card's `showOpenArtifactTab` answers false for its own artifact and when no action is registered, and otherwise passes `location` only when there is one (the argument forms).
   - Decision: decision 5's "the side column is left as it is" means what the column shows and where it stands in it: through `openArtifactTab`'s `revealMain()`, "Show that tab" docks a maximized or floating side column before the tab comes forward, as ⌘-click does, since a maximized column would hide the tab the click shows. Ruled by the architect, 2026-11-14 (UTC): accepted as built. "The side column is left as it is" means what it shows and where it is docked; a column that covers the main area yields to the tab the click shows, as every act that shows something in the main area does (`revealMain`), because a tab left hidden under the column would not be shown. The architect also accepted the three decisions above (the machine rule's place, the two exports with the frozen surface's entry, the native `defaultPrevented`).
   - Decision: the scene's picture passes `shootThemes`'s existing `before` hook through the scene's `shoot`, so each theme's shot is of the focused mention; A14.6's "nothing opened" is read at the end of A14.4 rather than by a timed wait.
   - Where: M2; Interfaces §E and §F; decision 5.

## Outcomes & Retrospective

Pending — written at finish.
