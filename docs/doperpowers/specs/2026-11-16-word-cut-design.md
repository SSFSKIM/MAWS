# The word cut (2026-11-16)

> **Parent:** `docs/charter.md`, the root spec (MAWS's standing purpose, §1). **Level name:** the word cut, the first built part of the visual renewal that `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` hands items to; it applies that wave's law 3, "Less on screen", to the text of the whole window. **Pin:** every decision here was made on master `2c7044231`; "today" in this document and its tables means the app at that commit. **State:** the design is approved by the owner (two rounds of pictures, 2026-11-15 and 2026-11-16); nothing is built on master. **It waits for the UX wave** (board #573): the wave rewrites many of the same surfaces, so the cut is applied afterwards, fresh, from this document and its tables, never by merging the scratch branch named under "Reference material". **Board:** #720. **Contracts:** none of X1 to X8 changes; the work is in the renderer and the artifact editors.

## Purpose

MAWS puts more words on screen than the owner reads. Many explain how the app or the engine works, repeat what the place already says, or name the normal state. The owner's judgment, from daily use and from comparing with Claude Desktop: the window should say less and stay as easy to find one's way in.

After this work a person sees, at rest, the words that tell them where they are, what is waiting and what could have failed, and little else. A finished turn reads "3s · Ran an agent". A settings row is its label and its control; its explanation opens in the row when the row is pointed at or focused. A plugin row is the plugin's name, its author and its version; its description opens in the row when it is pointed at. A panel heading with a count reads "Agents 2". What was cut is not lost: explanations and secondary facts wait for the pointer or keyboard focus in the place they describe, and every control keeps its accessible name.

How to see it working: open the build beside today's build on the same fixtures and go through the scenes of "Acceptance". The owner judges by pictures of the real app, before and after, not by lists; that is how every decision here was made and how the build is accepted.

## Progress

- [x] (2026-11-14) The inventory: every piece of text the window can show, read from the source at the pin by five readers, merged to 2,019 items with a proposal each.
- [x] (2026-11-15) The fullest cut applied to a scratch branch at the pin; before and after pictures of the real app; the owner's round-one calls (47 screens, 45 items brought back).
- [x] (2026-11-15) The scratch branch revised to those calls; a second set of pictures for the states round one never reached.
- [x] (2026-11-16) The owner's round-two calls (68 screens, 18 items brought back, nothing further cut); the decisions in `2026-11-16-word-cut/items.json`.
- [x] (2026-11-16) The adversarial review of this document; its eight findings resolved in the text and in six rows (Decision Log).
- [x] (2026-11-16) This document and its tables.
- [ ] The UX wave lands (board #573).
- [x] (2026-11-16) Board #720 registered, blocked by #573.
- [x] (2026-11-16) The owner's answer on plugin rows; nothing is open with the owner.
- [ ] M0: the list re-read against master as the wave left it.
- [ ] M1 to M5: the cut built area by area, each with pictures and the owner's call.
- [ ] Retrospective.

## Acceptance

The work closes when all of these hold on one build.

1. **The scenes the owner ruled on read as ruled.** On the scenes of `2026-11-16-word-cut/scenes.md` (among them `shell-tools`, a tool-heavy finished session; `r2-run-transcript`, two running agents and a background shell; `session-approval` and `session-question`; the `settings-*`, `customize-*` and `artifacts-*` scenes; `artifact-document`), as M0 carried them onto master:
   - a finished turn's line reads its duration and what it did, "3s · Ran an agent", with no "Worked for"; a stopped or failed turn keeps its word;
   - a running agent's line in the conversation is a spinner and the description its parent gave when it started the agent, and nothing else at rest;
   - the Agents card reads "Agents" and a bare count, and a running agent's row keeps its second line ("Working", or what it is doing);
   - the chip under the message box reads the model and the effort, "Sonnet 5 High";
   - a Settings row shows its label and control; pointing at it, or moving keyboard focus into it, shows its note in the row;
   - a plugin row in Customize is its name, "by <author>" and its version; pointing at it or focusing inside it shows its description in the row;
   - the document editor's header ends with "All changes saved" after a save;
   - the Projects page has its title, each project's folder path under its name and a "Hide from sidebar" button, and has no sentence at its top.
2. **Every changed surface has a picture pair the owner has called.** For each surface a milestone changes, a before and an after picture of the real app on the same fixture exist, and the owner has either called the after good or named what comes back, and that is built. This binds hardest for the items whose basis is `pattern` (see "How firm each decision is"): the owner has never seen them, and in the two rounds the owner brought back about one in four, then one in six, of what was shown.
3. **What was to stay, stayed.** Every `stays` row that M0 found still present on master reads as it did on master before this work; M0's record says which those are. A `stays` text the UX wave itself rewrote or removed is the wave's, and is not put back. A consent, permission or destructive-step text the wave rewrote is still protected: it does not become a candidate.
4. **Nothing is reachable by the pointer alone.** Whatever leaves the resting surface for a pointed row also shows on keyboard focus, and is in the row's accessible description at all times. Every control whose word became a glyph keeps the word as its accessible name and as its tooltip. The tests include the cases a plain row does not cover: the reason on a greyed control, a read-only field, and a native select's options, each revealed with the keyboard alone.
5. **Nothing is blank that used to say something.** An empty list says it is empty; an empty page or panel also says what to do; a wait of more than half a second shows a spinner.
6. **Nothing gated got worse.** The build passes class 1a through `scripts/ci-gate.sh` and the Electron e2e groups on a Mac, with every test and scene that asserted on a cut text changed to assert on what the surface now shows (or on its accessible name), not deleted.

## How the list was made

The list is not a set of opinions about copy. It was built in four steps, each of which the next one corrected.

**The inventory.** Five readers each took one part of the renderer and the artifact editors at the pin and wrote down every text a person can see: where it is, when it shows, and a proposal (keep, remove, shorten, hide behind the pointer, merge, or replace with a mark), judged against 23 rules written beforehand (for example "said twice", "explains the mechanism", "names the normal state", "durations"). Two parts overlapped, so about 360 items were read twice; the merge kept both readings and marked where they disagreed. The result is 2,019 items, of which 959 were proposed "keep" and 1,060 were candidates for a change. Only the 1,060 are in the tables.

**The owner would not judge a list.** A page of 1,060 proposals was shown to the owner and rejected: a line such as "remove 'Worked for 2m 14s'" cannot be judged without seeing the screen it leaves behind. So the fullest version of the cut was applied to the real app on a scratch branch, and a screenshot rig took the same 51 screens, then 107, from both builds on the same fixtures.

**Round one** (2026-11-15). The owner judged 47 screens, saw 164 of the applied cuts, and brought back 45: about one in four. The calls were turned into the five-line pattern below, the pattern was applied to the items the owner had not seen, and the scratch branch was revised to match.

**Round two** (2026-11-16). 42 screens of states round one never reached (running agents, cards opened, dialogs from typed commands, editors' side panels, failures) and 26 revised screens. The owner judged all 68, brought back 18 of the 106 items shown as changed, cut nothing further, and added seven rulings in words.

What the pictures could not reach is in "How firm each decision is".

## Design

### The pattern

These five rules are the owner's calls generalised. They decide every item the owner did not see, and they decide new text that appears after this document (the UX wave's, and anything later). Each is stated with what the owner did that it comes from. [binding]

1. **Cut what explains.** Sentences about how the app or the engine works, preambles, helper sentences, developer words, anything said twice, page titles that name where the person already is, and words for the default state (Idle, finished, Modified, exit 0). A helper sentence is not deleted: it moves to a note that opens in its row when the row is pointed at or focused. *From:* Settings, where the owner left every row's sentence cut and asked for the explanation on pointing; the titles of Overview, Settings, Artifacts and Customize; "started working" and "finished" on agent lines.
2. **Keep what orients.** Which machine, branch, model and effort, account and project; a message's time and how long a turn took; a row's age and who did what to it; counts of what waits, works, is connected or is loaded; and a status that confirms something that could have failed (Connected, All changes saved). A unit stays with its number ("1,403 tokens", "autocompact at 167,000"). *From:* every one of these was cut on the scratch branch and brought back by the owner.
3. **Keep the structure and the ways in.** Section and group headings, the heading of a popover, navigation rows and links, view switches, the strip for making something new, and buttons that name where they lead. A named way in is never replaced by "press this other thing". Nothing is left blank: an empty area says it is empty, an empty page or panel also says what to do, and a wait shows a spinner, because a blank reads as "not loaded" (the owner's reason for keeping "Nothing running"). *From:* the Projects row and the PROJECTS heading in the sidebar, "Needs you", "Context window", "Files" and "Session info" on the session card.
4. **Shorten in plain words, never invented ones.** The short form must mean the same out of context ("Untracked", not "new"; "Zoom to board", not "Zoom to"). A known term stays beside its plain name ("Connectors" with "MCP servers"). A glyph replaces a word only where nobody can misread it: editor toolbar icons, a switch for a setting, ↑1 for commits ahead, a check. A glyph never stands for a number or a badge, and never replaces the action word of a control: Dismiss, Mark viewed, Remove, Export, Hide from sidebar and the message box's key hint all stay words, and a worded button does not become a switch. *From:* the owner's reversals of "new", "In use", the dot badges, and each of those buttons.
5. **What waits for the pointer appears where you point.** A row's description or helper sentence shows in the row itself, after a short delay on pointing and at once on keyboard focus, never in the system's tooltip. (A secondary fact about one word or glyph, such as an identifier, a full path or a shortcut, may be that word's tooltip, provided the word takes keyboard focus.) The facts people use to tell rows apart stay on the row at rest (a project's folder path, a connector's scope and path, an artifact's edit line). A fold keeps its count and its kinds ("Working record · 1 tool call · 1 message", a caption's "+6") and the names that matter (the skill or connector a turn used). An error keeps its way out (the failed page's tips), and a state the person must act on keeps its reason (why the queue paused). *From:* the plugin rows, the Projects page, the caption rule the owner stated twice, and round two's bring-backs.

Where two rules meet, 2 and 3 win over 1: a text that orients or is a way in stays even if it also explains.

**Which text wins when two disagree.** A `seen`, `brought back` or `ruled` row wins over a rule: the owner looked at it. Three such rows are exceptions a builder would otherwise "correct", and they stand as the owner saw them: the question card shows its position among several questions as dots (C103), though rule 4 bars a dot for a number; the design system page's three header actions are icons (G558), though two of the icons are not conventional; the Settings index has no group headings, only a gap between the two runs of names (G3), though rule 3 keeps headings. A rule wins over a `pattern` row: such a row that breaks a rule is a defect in the tables, to be corrected in `items.json` with a Decision Log line (the review of this document found two, T205 and G615). This document's "What the cut builds" wins over any row's description of how a note or a line is revealed.

### Rulings on particular surfaces

The owner's own additions and the cases where the pattern alone would have gone the other way. The tables carry each under its item; they are gathered here because a builder who knows the pattern would otherwise undo them.

| Surface | Ruling | Items |
|---|---|---|
| Turn line | The duration alone and what the turn did: "3s · Ran an agent". "Worked for" goes. Stopped, Failed and "Ended for your message" keep their words. A caption folded to "+N" still names every skill and connector the folded part used. | T1, T2 |
| Agent line in the conversation | A spinner while it runs, then the description the parent gave at spawn. What the agent is doing now, and for how long, shows on pointing. Never the agent type in the description's place. | T86, T87 |
| Agents panel and card | "Agents", not "Subagents". A bare count. A running row keeps "Working" or its current activity. "Status is known only while the session runs here" stays shown. | T152, T161, T159 |
| Background | "Nothing running" stays, so that an empty panel is not read as one that failed to load. The Done heading keeps its kinds. | T206, T205 |
| Sidebar | The Projects row, the PROJECTS heading, "Needs you" with each row's project, and each session row's age stay. | W37, W45, W44, W61 |
| Question card | Keeps its state: "Answered", "Partially answered", "Not answered". "Dismiss" stays a worded button, and the cut adds no × to the card: a × that closes the card while the question keeps waiting is board #705. | T96, C106 |
| Approval card | Only what the owner brought back changes from the cut version; nothing else on it is restored. | see `session.md` |
| Review | "Mark viewed" stays as a worded button. | T360 |
| Model chip | Model and effort, "Sonnet 5 High". Because the chip carries both, `/config` no longer lists Model and Effort under Applied. | C36, C37, P609 |
| Context popover and `/context` | The popover keeps its heading and "Not observed yet". The dialog keeps "tokens" on each row and "autocompact at N" on its top line. | C45, C47, P603, P600 |
| Connectors dialog | Keeps "MCP servers" beside its title. | P559 |
| Messages to you | The fold above a message is not reworded to an invented count ("2 steps"): at the pin it keeps "Working record · N tool calls · N messages". The UX wave replaces that row; see "Meeting the UX wave". The Settings row for the view explains itself on pointing, with both sentences. | P509, G27 |
| Projects page | Keeps its title in the title bar, the folder path under each name and the "Hide from sidebar" button. Its top sentence goes and its group headings shorten ("In sidebar"). | W6, W131, W132, W129, W130 |
| Plugin rows | Name, "by <author>" and the version at rest; the description, with the date, in the row on pointing or focus. The owner's answer of 2026-11-16: the author and the version matter. No picture shows this form (the pictures had the name alone), so its picture pair is owed like a `pattern` row's. | G216, G218 |
| Skill and mod rows | Name at rest (a skill's plugin badge with it); description in the row on pointing or focus. | G225, G248, P683 |
| Editors | "All changes saved" stays in the header. Version history keeps "Export" on every version. The design inspector keeps its board heading, its "Board" section and "Board name". The design system's Type table keeps "Deck (shown at half size)". | G369, G536, G571 |
| Failed page in the browser | Keeps its tips. | T417, T418 |
| Paused queue | Keeps why it paused. | C72 |

### How firm each decision is

Every row of the tables has a basis. A builder treats them differently.

| Basis | Count | What it means | What the builder owes |
|---|---|---|---|
| `seen` | 186 | The owner saw the surface with this cut in a picture and left it. | Build it as the row's After states; the picture is not needed. |
| `brought back` | 61 | The owner saw it cut and asked for it back: 59 stay as today, 2 come back in a changed form. | Leave it, or build the changed form the row states. |
| `ruled` | 9 | The owner stated it in words. | Build it as stated. |
| `pattern` | 622 | Decided by the five rules; the owner has not seen it. 546 are cuts, 16 rewordings, 60 stay. | Build it, then show the owner the before and after (Acceptance 2). Expect some to come back. |
| `unseen` | 93 | The pattern did not settle it and no picture reached it. Stays as today. | Leave it. If a later picture reaches it, ask. |
| `consent` | 33 | Text of a consent, permission or destructive step. Never a candidate. | Leave it. |
| `not a cut` | 56 | The proposal was a rename or a redesign, not a removal; it belongs to the visual renewal. | Leave it. |

The pictures could not reach: dashboard tiles in their stale and paused states, a paused queue with waiting messages, scheduled jobs and workflow tables in Background, the resume dialog, Settings › Org when signed in, the presenter view, Discover with real cards, source control behind or in conflict, and most error texts. The `pattern` and `unseen` rows are concentrated there. M0 should extend the fixtures to reach as many as it reasonably can before the cut touches them.

### What the cut builds

Most rows are a string removed or shortened in a `copy.ts`. A minority need a mechanism, and the same few mechanisms serve all of them. Build each once and reuse it; the scratch branch built several of them twice in different ways, which is the main thing not to copy from it.

- **The row note.** A row's helper text, hidden at rest, shown in the row when the row is pointed at (after a short delay) or holds keyboard focus (at once), and present at all times as the row's accessible description. A line that states a condition the person must act on is not a note and stays at rest. Settings rows, and any list whose rows have a description.
- **The pointed-row line.** A second line under a row's name that appears on pointing or focus: a plugin's author and description, a skill's description. Same rule as the note; it should be the same component.
- **The named glyph.** A toolbar or row button whose word became an icon keeps the word as its accessible name and its tooltip, and its shortcut in the tooltip where it has one. Only for the glyphs rule 4 allows.
- **The bare count.** A heading followed by a number, with the number's meaning ("2 running") as its accessible name and tooltip.
- **The quiet spinner.** Nothing for the first half second of a wait, then a small spinner where the content will be, carrying the wait's words as its accessible name. It replaces "Reading…", "Loading…" and their kin.
- **The counted fold.** A block that folds to one line keeps a count and opens in place ("Listed 9 agents"; a caption's "+N").
- **Hidden headings.** A heading cut from view because the tab or the sidebar row already names the place stays in the document for assistive technology.

**Every hidden fact has an owner that takes keyboard focus.** A greyed button, a greyed field and a heading do not take focus, and a native select's options show nothing on hover that the keyboard can reach. So the reason a control is greyed (the slide limit on New slide, G423; the shadow restriction on Spread and Inset, G450; "Write a commit message" beside Commit, T391) belongs to an enabled owner: the control drawn as `aria-disabled` and still focusable, or its row. An explanation moved to a heading (G130) belongs to a row note under that heading. A fact moved to an option's hover (G609) shows for the selected value instead. The rows this concerns end with a sentence pointing here.

Two placements were shown to the owner and accepted as shown; they are the required baseline. The Settings note opens under its row and pushes the following rows down while it is open. The plugin row reserves the height of its second line at rest, so the list is taller than a list of names needs to be. Each has a cost, and one behaviour for both would be better: the rows under the pointer do not move, and no height is spent at rest. That is an optional attempt inside M1: if a prototype achieves it, it is shown to the owner beside the baseline and built only on the owner's call; otherwise the baseline is built.

### Seen on the scratch build and to be put right

- The agent page's back link reads "‹ Subagents" while the tab reads "Agents".
- The hooks dialog still reads "Startup settings (--settings option)".
- In the Artifacts library, "New Space" became a bare "+", against rule 4.
- In a turn's caption, "+6" (six more actions) sits directly before the edit's "+4 −2" and reads as part of the line counts. It needs a separator or a different place.
- "Git unavailable" shows twice on the Environment card, at the top right and as a row.
- The deck editor's saved status reads "All changes saved" where the app said "Saved"; one wording across the editors is wanted, the owner has seen "All changes saved".

### Meeting the UX wave

The cut was decided on `2c7044231`. By the time it is built, the UX wave (board #573) will have rewritten transcript rows, request cards, the composer, the side panels, Settings, Customize and the library. Three things follow.

- **A row's text may be gone or different.** M0 re-reads every row against master then. A row whose surface the wave removed is closed as moot. A row whose text the wave rewrote is decided again by the pattern, as a `pattern` row. A row whose text only moved is built as written.
- **Where the wave's design and a row here disagree, the wave's text stands.** The wave's children were designed with the owner on the surfaces as they will be; the owner's calls here were made on pictures of the pin. A row that would change a text the wave's design fixed, or restore one the wave removed, is not built as written: M0 records it, and it is put to the owner again as a picture pair on the wave's surface. Known on 2026-11-16, from the wave's documents:
  - **The working record (P509).** U2's O-30 replaces the pin's counted row with the mod's own fold, one `› working record` line per stretch with no count, drawn by the mod where a mod can draw and mirrored by MAWS elsewhere (wave law 2, a pure mods client). MAWS does not add a count over the mod's line. P509 closes as moot once U2b has landed; what remains of the owner's call is that the fold is not reworded to an invented form.
  - **Background and Agents (P66, P67, P72, T205).** U8's O-09 names the panel "Background tasks", heads its sections "Running N" and "Done N" with the kinds counted, and keeps "Nothing running". Here the owner called good "Agents" for "Subagents", "Background" for "Background tasks" and a bare count for "N running" on the cards. T205 is corrected to the wave's wording. The other three are shown again on U8's column.
  - **Source control (T371, T379 to T405, P228 to P250).** U5 makes Source control a page to read with no action in it (its S2: no text field, no checkbox, no action element). The rows about Push, Open PR, the group actions, the commit form and the Output are moot where U5 removed their surface.
  - **The Artifacts card (T562).** U8 removes it from the column; the row is moot.
  - **The library's make-new strip (G291).** U10's l6-artifacts-08 redraws "Make something new" as four cards that ask, in place of a card per kind with "New" and "Ask Claude". The `stays` row is the wave's to change.
  - **Customize (G216, G225, G248).** U11's combined list mixes plugins, skills, connectors and mods in one list with a kind word on each row and a Show control (`src/renderer/src/customize/copy.ts`, added after the pin). A row's resting text there is its name and its kind word, with the author and version on a plugin's row: the kind is how mixed rows are told apart (rule 5).
  - **The model menu (C40, C42).** U11b removes the "Default" row and writes the default on a pick, so the line under "Default" and "For this session only" need no work.
  - **Requests (the question and approval card rows).** U1b draws requests in the transcript; the rows are read against that drawing.
- **The wave adds text, in new files too.** Every string added after the pin is outside the tables, and some are in modules that did not exist at the pin, so no row's Source leads to them. M0 lists them from the whole diff of the renderer and the artifact editors between the pin and master, and applies the pattern; all of them are `pattern` rows.

### Not in this work

- The 959 inventory items proposed "keep". They are not in the tables.
- The `consent` and `not a cut` rows.
- Colour, type, spacing and the drawing of surfaces: the rest of the visual renewal. The cut is built with today's tokens and components.
- New behaviour. The one behaviour change the owner asked for while judging, a × on the question card that closes it without dismissing, is board #705.

## The tables

One file per area under `docs/doperpowers/specs/2026-11-16-word-cut/`, written by `render.py` there from `items.json` in the same directory. `items.json` is the record: a decision changes there and in the Decision Log below, and `python3 docs/doperpowers/specs/2026-11-16-word-cut/render.py` rewrites the tables.

| File | Area | Items | Cut | Reworded | Stay |
|---|---|---|---|---|---|
| `session.md` | The conversation and the message box | 172 | 114 | 3 | 55 |
| `beside.md` | Panels beside the conversation | 314 | 209 | 6 | 99 |
| `window.md` | Window, sidebar, sheets and overview | 105 | 72 | 1 | 32 |
| `typed.md` | Dialogs opened by typed commands | 52 | 43 | 0 | 9 |
| `settings.md` | Settings | 115 | 90 | 1 | 24 |
| `customize.md` | Customize | 81 | 40 | 5 | 36 |
| `artifacts.md` | Artifacts: the library and an opened artifact | 62 | 33 | 1 | 28 |
| `editors.md` | Artifact editors | 159 | 131 | 5 | 23 |
| | | 1,060 | 732 | 22 | 306 |

Each item in `items.json` has: `id`; `area`, `place`, `surface`, `where`; `today` (the text at the pin, an example value where the text is built from data); `decision` (`cut`, `reword`, `stays`); `basis`; `after` (what the surface shows afterwards, as built on the scratch branch); `why`; `round` (which round of calls last touched it); `source` (file and line at the pin); and `scratch_files` (the files the scratch branch changed for it, as a pointer to how much the item involves, not as a recipe). M0 adds its own field beside these (unchanged, moved, rewritten by the wave, gone, moot) and the current source; it does not overwrite `today`, `decision` or `source`, which stay the record of what the owner decided on.

`scenes.md` in the same directory lists the 107 scenes the pictures were taken of: what each is, how it is reached and the state it shows. `rig/words-shots.spec.ts.txt` is the Playwright spec that reached them at the pin, kept as text so that no gate reads it.

## Plan of Work

This is the cut the design implies, for whoever takes the board ticket to confirm or redraw against the code as the wave left it. The work is too large for one executor and its parts share the mechanisms above, so it is a composite: M0 and M1 first, then M2 to M5 in any order.

### M0 — The list against master, and the fixtures

Re-read all 1,060 rows against master: find each by its text and its source, and mark it unchanged, moved, rewritten by the wave, gone or moot, starting from the list in "Meeting the UX wave". Read the whole diff of `src/renderer/src` and `src/artifacts` between the pin and master for visible strings, in new modules as well as old, and add a `pattern` row for each. Bring the rig into the repository's e2e support from `rig/words-shots.spec.ts.txt`, repair its scenes against master (it finds elements by data attributes and positions, which the wave will have moved), and extend its fixtures toward the states "How firm each decision is" names. Assign every surviving and every new row to one of M1 to M5 and to a scene, or record why no scene can reach it. At the end the record describes master as it is, and the rig produces the "before" picture of every surface M1 to M5 will change. Proof: the regenerated tables with M0's field filled on every row; the scene list; the set of "before" pictures.

### M1 — The mechanisms, and Settings as their first use

Build the row note, the pointed-row line, the named glyph, the bare count, the quiet spinner and the hidden heading as shared parts, each with its unit tests (shown on pointing, shown on focus, described at rest, absent from the resting text). Apply the Settings rows (`settings.md`), which use most of them and which the owner saw most completely (56 of 91 changes seen or ruled). Proof: Acceptance 4 and 5 as tests; the Settings picture pairs called by the owner.

### M2 — The conversation and the message box

`session.md`: turn lines and captions, agent lines, step lines, the question and approval cards, the message box's row and its queue. Read against U1b, U2b, U3 and U4 as landed. Proof: Acceptance 1's first four scenes; picture pairs.

### M3 — Panels beside the conversation

`beside.md`: session cards, Agents, Background, Source control, Review, Files, Browser, Session info, Channel. The largest file and the one with the most unseen rows (168 of 215 changes). Proof: picture pairs, with the extended fixtures of M0.

### M4 — Window, typed dialogs, Customize

`window.md`, `typed.md`, `customize.md`. Proof: the Projects and plugin scenes of Acceptance 1; picture pairs.

### M5 — Artifacts and the editors

`artifacts.md`, `editors.md`. The editors are separate bundles under `src/artifacts/`; the named glyph and the spinner must be usable there or have a twin. 121 of 136 editor changes are unseen. Proof: the saved-status scene; picture pairs.

## Constraints for the build

- **Tests assert on text.** The scratch branch changed 395 files and no test; it was never typechecked and its suites were never run. A real build will break every unit test and e2e scene that finds an element by a text the cut removes. Those are changed to find the element by role and accessible name, which Acceptance 4 guarantees still exists. Expect this to be a large share of each milestone.
- **Copy lives in `copy.ts` files** beside each module (39 of them changed on the scratch branch). A text cut from view but kept as an accessible name stays in the copy file under a name that says so.
- **Typechecks run in CI only**, through `scripts/ci-gate.sh`; Electron e2e runs on a Mac under the load rule (CLAUDE.md, Gates).
- **Pictures are fixtures only.** The rig drives the app on the repository's fixtures under a scratch profile. No picture of a real session is taken, kept or committed.

## Reference material outside the repository

Kept by the session that wrote this document (sminos alias `design-experiment`, project MAWS, on the MacBook), in its lab folder and in the architect checkout; ask that session or the owner for them. None of it is needed: each row's After is the contract, the scenes and the rig are in the repository, and the pictures can be taken again. All of it saves time.

- **The scratch branch** `words-cut` (local, not pushed), three commits on `2c7044231`, head `d8f74401c`: the cut as the owner saw it in round two. It is a drawing, not a change: no typecheck, no tests, mechanisms built twice. **It is never merged or rebased onto master.**
- **The rig's runner**: the script that builds a worktree, copies the spec into its `e2e/` and runs it. The spec itself is in the repository (`rig/`).
- **The pictures**: 107 screens from each build, and the two pages the owner judged on.
- **The owner's calls**, both rounds, as written.
- **The inventory**: all 2,019 items with both readings where two readers met, and the 23 rules.

## Surprises & Discoveries

- **A list of proposals cannot be judged.** The owner could not rule on "remove X" lines and said a ruling made that way might be wrong. Every later step used pictures of the real app. The same will hold for the `pattern` rows.
- **The first cut was too literal.** Applied exactly as proposed, it made the Projects page unreachable (its sidebar row was "said twice"), removed the "Needs you" section, and hid the editors' saved status. Each was a rule followed past the point where it served the person. Rules 2 and 3 exist because of them.
- **One in four, then one in six.** The share of seen cuts the owner brought back fell between the rounds as the pattern absorbed the first round's calls, but it did not approach zero. A cut nobody has looked at is a proposal.
- **Typechecks on the scratch branch stalled the machine.** Ten whole-tree typechecks started at once by the workers that applied the cut exhausted memory for about four hours. Typechecks belong to CI (CLAUDE.md, Gates); the scratch branch then ran none, which is one more reason it is not a change.
- **The agent line already read the spawn description.** The owner asked for it as a change in round two; the fixture's lines were the descriptions. No work, but the rule is now written (Rulings).

## Decision Log

- 2026-11-15. **Pictures, not a list.** The owner rejected the list page. Alternative rejected: a shorter list grouped by rule; it has the same defect.
- 2026-11-15. **The cut is applied fresh after the UX wave, from a written list.** The owner's choice among: merging the scratch branch now (rejected: about ten wave branches were in flight on the same files, and the branch is untested), and rebasing it after the wave (rejected: 395 files against rewritten surfaces).
- 2026-11-15. **Unseen cuts get a second round of pictures** rather than being taken as agreed. The owner's choice; round one's one-in-four is the reason.
- 2026-11-15. **The approval card restores only what the owner named.** The owner's answer when offered further restorations on it.
- 2026-11-16. **Items no picture reached and the pattern did not settle stay as today** (93). Alternative rejected: applying each one's lean; 82 leaned to cut, with nothing to check them against.
- 2026-11-16. **`pattern` cuts are built, then shown.** They are not held back for a third round first, because the surfaces will have changed under the wave and pictures taken now would be of the wrong app.
- 2026-11-16. **After the review of this document.** Six rows corrected in `items.json`: T205 from cut to stays (rule 5 and U8's O-09); G615 from cut to reword (rule 3: an empty panel says what to do); C106 from reword to stays (the × it described is #705's); G13 to G15 rewritten to the in-row note the owner saw, where they had described the first pass's floating card. P509 is recorded as moot after U2b (the wave's uncounted fold stands; alternative rejected: a count added by MAWS over the mod's line, against wave law 2). The scene manifest and the rig's spec were brought into the repository so that acceptance does not depend on material outside it. Totals after the corrections: 732 cut, 22 reworded, 306 stay.
- 2026-11-16. **Plugin rows: name, author and version at rest; description on pointing.** The owner's answer to the one line where the two rounds disagreed (round one asked for the name alone; round two's list marked the change "bring back" while both pictures were called good). Alternatives the owner was shown and did not take: the name alone, and everything as today. The date goes with the description: the owner named the author and the version as what matters, not the date.
- 2026-11-16. **Verification.** This document: one adversarial review of its buildability. The build: the rung the taking session names per milestone, and the owner's call on every picture pair.

## Outcomes & Retrospective

Not built yet.
