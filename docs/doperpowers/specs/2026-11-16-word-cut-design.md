# The word cut (2026-11-16)

> **Parent:** `docs/charter.md`, the root spec (MAWS's standing purpose, §1). **Level name:** the word cut, the first built part of the visual renewal that `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` hands items to; it applies that wave's law 3, "Less on screen", to the text of the whole window. **Pin:** every decision here was made on master `2c7044231`; "today" in this document and its tables means the app at that commit. **State:** the design is approved by the owner (two rounds of pictures, 2026-11-15 and 2026-11-16); nothing is built on master. **It waits for the UX wave** (board #573): the wave rewrites many of the same surfaces, so the cut is applied afterwards, fresh, from this document and its tables, never by merging the scratch branch named under "Reference material". **Board:** #720. **Contracts:** none of X1 to X8 changes; the work is in the renderer and the artifact editors.

## Purpose

MAWS puts more words on screen than the owner reads. Many explain how the app or the engine works, repeat what the place already says, or name the normal state. The owner's judgment, from daily use and from comparing with Claude Desktop: the window should say less and stay as easy to find one's way in.

After this work a person sees, at rest, the words that tell them where they are, what is waiting and what could have failed, and little else. A finished turn reads "3s · Ran an agent". A settings row is its label and its control; its explanation opens in the row when the row is pointed at or focused. A plugin row is the plugin's name. A panel heading with a count reads "Agents 2". What was cut is not lost: explanations and secondary facts wait for the pointer or keyboard focus in the place they describe, and every control keeps its accessible name.

How to see it working: open the build beside today's build on the same fixtures and go through the scenes of "Acceptance". The owner judges by pictures of the real app, before and after, not by lists; that is how every decision here was made and how the build is accepted.

## Progress

- [x] (2026-11-14) The inventory: every piece of text the window can show, read from the source at the pin by five readers, merged to 2,019 items with a proposal each.
- [x] (2026-11-15) The fullest cut applied to a scratch branch at the pin; before and after pictures of the real app; the owner's round-one calls (47 screens, 45 items brought back).
- [x] (2026-11-15) The scratch branch revised to those calls; a second set of pictures for the states round one never reached.
- [x] (2026-11-16) The owner's round-two calls (68 screens, 18 items brought back, nothing further cut); the decisions in `2026-11-16-word-cut/items.json`.
- [x] (2026-11-16) This document and its tables.
- [ ] The UX wave lands (board #573).
- [x] (2026-11-16) Board #720 registered, blocked by #573.
- [ ] M0: the list re-read against master as the wave left it.
- [ ] M1 to M5: the cut built area by area, each with pictures and the owner's call.
- [ ] Retrospective.

## Acceptance

The work closes when all of these hold on one build.

1. **The scenes the owner ruled on read as ruled.** On the fixtures the pictures used (a tool-heavy finished session, a session with two running agents and a background shell, the approval and question cards, Settings, Customize, the Artifacts library, an opened document):
   - a finished turn's line reads its duration and what it did, "3s · Ran an agent", with no "Worked for"; a stopped or failed turn keeps its word;
   - a running agent's line in the conversation is a spinner and the description its parent gave when it started the agent, and nothing else at rest;
   - the Agents card reads "Agents" and a bare count, and a running agent's row keeps its second line ("Working", or what it is doing);
   - the chip under the message box reads the model and the effort, "Sonnet 5 High";
   - a Settings row shows its label and control; pointing at it, or moving keyboard focus into it, shows its note in the row;
   - a plugin row in Customize is its name; pointing at it or focusing inside it shows its author and description in the row (see "Open with the owner");
   - the document editor's header ends with "All changes saved" after a save;
   - the Projects page has its title, each project's folder path under its name and a "Hide from sidebar" button, and has no sentence at its top.
2. **Every changed surface has a picture pair the owner has called.** For each surface a milestone changes, a before and an after picture of the real app on the same fixture exist, and the owner has either called the after good or named what comes back, and that is built. This binds hardest for the items whose basis is `pattern` (see "How firm each decision is"): the owner has never seen them, and in the two rounds the owner brought back about one in four, then one in six, of what was shown.
3. **Every `stays` item reads as today.** The 304 items the tables mark `stays` are unchanged, the consent and safety texts among them.
4. **Nothing is reachable by the pointer alone.** Whatever leaves the resting surface for a pointed row also shows on keyboard focus, and is in the row's accessible description at all times. Every control whose word became a glyph keeps the word as its accessible name and as its tooltip.
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
5. **What waits for the pointer appears where you point.** A row's description shows in the row itself, at once, not in the system's delayed tooltip, and equally on keyboard focus. The facts people use to tell rows apart stay on the row at rest (a project's folder path, a connector's scope and path, an artifact's edit line). A fold keeps its count and its kinds ("Working record · 1 tool call · 1 message", a caption's "+6") and the names that matter (the skill or connector a turn used). An error keeps its way out (the failed page's tips), and a state the person must act on keeps its reason (why the queue paused). *From:* the plugin rows, the Projects page, the caption rule the owner stated twice, and round two's bring-backs.

Where two rules meet, 2 and 3 win over 1: a text that orients or is a way in stays even if it also explains.

### Rulings on particular surfaces

The owner's own additions and the cases where the pattern alone would have gone the other way. The tables carry each under its item; they are gathered here because a builder who knows the pattern would otherwise undo them.

| Surface | Ruling | Items |
|---|---|---|
| Turn line | The duration alone and what the turn did: "3s · Ran an agent". "Worked for" goes. Stopped, Failed and "Ended for your message" keep their words. A caption folded to "+N" still names every skill and connector the folded part used. | T1, T2 |
| Agent line in the conversation | A spinner while it runs, then the description the parent gave at spawn. What the agent is doing now, and for how long, shows on pointing. Never the agent type in the description's place. | T86, T87 |
| Agents panel and card | "Agents", not "Subagents". A bare count. A running row keeps "Working" or its current activity. "Status is known only while the session runs here" stays shown. | T152, T161, T159 |
| Background | "Nothing running" stays, so that an empty panel is not read as one that failed to load. | T206 |
| Sidebar | The Projects row, the PROJECTS heading, "Needs you" with each row's project, and each session row's age stay. | W37, W45, W44, W61 |
| Question card | Keeps its state: "Answered", "Partially answered", "Not answered". "Dismiss" stays a worded button. A separate × that closes the card while the question keeps waiting is board #705, not this work. | T96, C106 |
| Approval card | Only what the owner brought back changes from the cut version; nothing else on it is restored. | see `session.md` |
| Review | "Mark viewed" stays as a worded button. | T360 |
| Model chip | Model and effort, "Sonnet 5 High". Because the chip carries both, `/config` no longer lists Model and Effort under Applied. | C36, C37, P609 |
| Context popover and `/context` | The popover keeps its heading and "Not observed yet". The dialog keeps "tokens" on each row and "autocompact at N" on its top line. | C45, C47, P603, P600 |
| Connectors dialog | Keeps "MCP servers" beside its title. | P559 |
| Messages to you | The fold above a message keeps "Working record · N tool calls · N messages". The Settings row for the view explains itself on pointing, with both sentences. | P509, G27 |
| Projects page | Keeps its title in the title bar, the folder path under each name and the "Hide from sidebar" button. Its top sentence goes and its group headings shorten ("In sidebar"). | W6, W131, W132, W129, W130 |
| Plugin, skill and mod rows | Name at rest; description in the row on pointing or focus. | G216, G218, G225, G248, P683 |
| Editors | "All changes saved" stays in the header. Version history keeps "Export" on every version. The design inspector keeps its board heading, its "Board" section and "Board name". The design system's Type table keeps "Deck (shown at half size)". | G369, G536, G571 |
| Failed page in the browser | Keeps its tips. | T417, T418 |
| Paused queue | Keeps why it paused. | C72 |

### How firm each decision is

Every row of the tables has a basis. A builder treats them differently.

| Basis | Count | What it means | What the builder owes |
|---|---|---|---|
| `seen` | 186 | The owner saw the surface with this cut in a picture and left it. | Build it as the picture showed. |
| `brought back` | 63 | The owner saw it cut and asked for it back: 58 stay as today, 5 come back in a changed form. | Leave it, or build the changed form the row states. |
| `ruled` | 7 | The owner stated it in words. | Build it as stated. |
| `pattern` | 622 | Decided by the five rules; the owner has not seen it. 548 are cuts, 15 rewordings, 59 stay. | Build it, then show the owner the before and after (Acceptance 2). Expect some to come back. |
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

Two placements were shown to the owner and accepted as shown, and each has a cost the builder should try to remove, showing the owner the result: the Settings note opens under its row and pushes the following rows down while it is open; the plugin row reserves the height of its second line at rest, so the list is taller than a list of names needs to be. One behaviour for both is wanted: the rows under the pointer do not move, and no height is spent at rest.

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
- **The wave already settles some rows.** Known on 2026-11-16: the wave's U11b removes the model menu's "Default" row, so C42 (the line under it) and C40 ("For this session only", which stops being true once a pick writes the default) need no work; U1b draws requests in the transcript, which the question and approval card rows must be read against; U2b draws the to-human view by the mod, which P509 and the rows around it must be read against.
- **The wave adds text.** Every string the wave added after the pin is outside the tables. M0 lists them and applies the pattern; all of them are `pattern` rows.

### Not in this work

- The 959 inventory items proposed "keep". They are not in the tables.
- The `consent` and `not a cut` rows.
- Colour, type, spacing and the drawing of surfaces: the rest of the visual renewal. The cut is built with today's tokens and components.
- New behaviour. The one behaviour change the owner asked for while judging, a × on the question card that closes it without dismissing, is board #705.

## The tables

One file per area under `docs/doperpowers/specs/2026-11-16-word-cut/`, written by `render.py` there from `items.json` in the same directory. `items.json` is the record: a decision changes there and in the Decision Log below, and `python3 docs/doperpowers/specs/2026-11-16-word-cut/render.py` rewrites the tables.

| File | Area | Items | Cut | Reworded | Stay |
|---|---|---|---|---|---|
| `session.md` | The conversation and the message box | 172 | 114 | 4 | 54 |
| `beside.md` | Panels beside the conversation | 314 | 210 | 6 | 98 |
| `window.md` | Window, sidebar, sheets and overview | 105 | 72 | 1 | 32 |
| `typed.md` | Dialogs opened by typed commands | 52 | 43 | 0 | 9 |
| `settings.md` | Settings | 115 | 90 | 1 | 24 |
| `customize.md` | Customize | 81 | 40 | 5 | 36 |
| `artifacts.md` | Artifacts: the library and an opened artifact | 62 | 33 | 1 | 28 |
| `editors.md` | Artifact editors | 159 | 132 | 4 | 23 |
| | | 1,060 | 734 | 22 | 304 |

Each item in `items.json` has: `id`; `area`, `place`, `surface`, `where`; `today` (the text at the pin, an example value where the text is built from data); `decision` (`cut`, `reword`, `stays`); `basis`; `after` (what the surface shows afterwards, as built on the scratch branch); `why`; `round` (which round of calls last touched it); `source` (file and line at the pin); and `scratch_files` (the files the scratch branch changed for it, as a pointer to how much the item involves, not as a recipe).

## Plan of Work

This is the cut the design implies, for whoever takes the board ticket to confirm or redraw against the code as the wave left it. The work is too large for one executor and its parts share the mechanisms above, so it is a composite: M0 and M1 first, then M2 to M5 in any order.

### M0 — The list against master, and the fixtures

Re-read all 1,060 rows against master: find each by its text and its source, and mark it unchanged, moved, rewritten or gone. List the strings the wave added in the same files and decide each by the pattern. Extend the screenshot fixtures toward the states "How firm each decision is" names. At the end, `items.json` and the tables describe master as it is, every row has a current source, and the rig produces today's pictures for every surface M1 to M5 will change. Proof: the regenerated tables, and a set of "before" pictures.

### M1 — The mechanisms, and Settings as their first use

Build the row note, the pointed-row line, the named glyph, the bare count, the quiet spinner and the hidden heading as shared parts, each with its unit tests (shown on pointing, shown on focus, described at rest, absent from the resting text). Apply the Settings rows (`settings.md`), which use most of them and which the owner saw most completely (56 of 91 changes seen or ruled). Proof: Acceptance 4 and 5 as tests; the Settings picture pairs called by the owner.

### M2 — The conversation and the message box

`session.md`: turn lines and captions, agent lines, step lines, the question and approval cards, the message box's row and its queue. Read against U1b, U2b, U3 and U4 as landed. Proof: Acceptance 1's first four scenes; picture pairs.

### M3 — Panels beside the conversation

`beside.md`: session cards, Agents, Background, Source control, Review, Files, Browser, Session info, Channel. The largest file and the one with the most unseen rows (169 of 216 changes). Proof: picture pairs, with the extended fixtures of M0.

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

Kept by the session that wrote this document (sminos alias `design-experiment`, project MAWS, on the MacBook), in its lab folder and in the architect checkout; ask that session or the owner for them. None of it is needed to build from this document; all of it saves time.

- **The scratch branch** `words-cut` (local, not pushed), three commits on `2c7044231`, head `d8f74401c`: the cut as the owner saw it in round two. It is a drawing, not a change: no typecheck, no tests, mechanisms built twice. **It is never merged or rebased onto master.**
- **The screenshot rig**: a Playwright spec that opens 107 screens on fixtures and a script that builds a worktree and runs it. M0 should bring it into the repository's e2e support in a form the gates accept.
- **The pictures**: 107 screens from each build, and the two pages the owner judged on.
- **The owner's calls**, both rounds, as written.
- **The inventory**: all 2,019 items with both readings where two readers met, and the 23 rules.

## Open with the owner

- **Plugin rows.** In round one the owner asked for the name alone with the description on pointing, and in round two called both plugin pictures good; round two's list also marks the line for that change "bring back". The tables carry the round-one reading (G216, G218). Asked on 2026-11-16; the answer goes to the Decision Log.

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
- 2026-11-16. **Verification.** This document: one adversarial review of its buildability. The build: the rung the taking session names per milestone, and the owner's call on every picture pair.

## Outcomes & Retrospective

Not built yet.
