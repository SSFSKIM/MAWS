# The UX wave (2026-11-12)

> **Parent:** `docs/charter.md`, the root spec (MAWS's standing purpose, §1), parent pin `dee757515`. **Level name:** the UX wave, a child of the charter beside phases P0 to P5; the charter's §3 paragraph and §19 entry that name it are carried by the pull request that lands this document. **Consumes:** the comparison of 2026-10-23 and the owner's marks on it; P4's UX waves (`docs/doperpowers/ledgers/2026-10-23-P4-UX1.md`, `2026-10-24-P4-UX2.md`, `docs/doperpowers/evidence/p4/ux-wave/`); P5 as built (`docs/doperpowers/plans/2026-10-27-p5-org.md`); the project registry (`docs/doperpowers/specs/2026-11-10-project-registry-design.md`). Children dispatch per their grain hint, each carrying its section as its spec; each child's execution document, ledger and pull request open by citing this document (path, child id, parent pin).

## Purpose

The owner uses MAWS every day to supervise Claude Code sessions, and has kept a list of what gets in the way: marks on a comparison of MAWS with Claude Desktop, later observations with screenshots, deferred board tickets, and findings from P5's sittings. 240 items in all. Some were already built, some asked for the same thing twice, some contradicted each other, and some named a problem without a settled answer.

This wave turns that list into changes the owner can see, under the owner's own bar: **every change a clear improvement, nothing hasty.** A change is made only when the code shows what is wrong and the direction of the fix is settled, by the owner's words, by Claude Desktop's behaviour where the owner named it as the answer, or by a question put to the owner. Where none of these holds, the item waits for an answer, a design round or a hands-on check, and this document says which.

After the wave: requests for the owner's attention are drawn where the work is and stop counting once answered; the transcript reads as the agent produced it, with tool runs folded into one line and the to-human view drawn by the mod; what arrives in a session from elsewhere takes one line; the composer queues and steers as Claude Desktop's does; Review, comments and source control are one simpler flow; a session on another machine can be forked, renamed and stopped like a local one; and the smaller defects in each surface are gone.

How to see it working: the owner's sitting on the wave's build, following the scene script composed from the children's acceptance (Parent-level acceptance, 2).

## Parent-level acceptance

The wave closes when all of these hold. They are checked as written at recomposition; all children landed is not the same event.

1. **Every item is accounted for.** Each of the 240 ids in the register (`docs/doperpowers/evidence/ux-wave-2026-11/register.md`) has a final state with its evidence: built and accepted by the owner; already fixed, with the commit named; dropped or moved by the owner's word; or waiting in a named place (the visual renewal, a tracker row, a board ticket).
2. **The owner calls each cluster a clear improvement.** The owner goes through the scene script on the wave's build on their own machines: one scene per cluster, composed from the children's acceptance items, each scene naming the items it shows. A scene the owner does not call a clear improvement is reworked or reverted before the wave closes. Agents pre-run every scene under a scratch config home and hand over the evidence first.
3. **What the owner marked `keep` is unchanged.** The 23 `keep` items in the register behave as before; the scene script includes a check for each one a child's work could have touched.
4. **Every reversed ruling is recorded.** Each earlier ruling this wave reverses (Decision Log, "Rulings reversed") has a dated entry in the document that held it, written when the reversing change lands.
5. **Nothing gated got worse.** The final build passes the gates of `scripts/ci-gate.sh` (class 1a), the Electron e2e groups on a Mac under the load rule, and the measured cases master is gated on at that time (the render group and the idle daemon's cases, as P5 left them); a case that was void or over its bound on build F (`f1852de3a`) by the owner's ruling is compared with its reading on F, not with its bound.

## Grounding baseline

The grounding ran on 2026-11-12 against `03cee6582` (build F plus documents; the source tree equals master `dee757515` outside `apps/desk-hub`). Eleven agents each grounded one surface in the code and in Claude Desktop `app-5.1231.2`, and a twelfth read the debt tracker and P5's records for further candidates; their files stay outside the repository (they describe the owner's screenshots).

| | count |
|---|---|
| Items | 240: 132 marks on the comparison, 50 observations, 32 board tickets, 13 sitting findings, 13 tracker rows that ride with an item |
| Already built or fixed | 25 |
| Marked keep by the owner | 23 |
| The same ask as another item | 13 |
| Not MAWS's to fix | 4 |
| Handed to the visual renewal | 3 |
| To build, direction settled | 145, of which 137 are in children U1 to U13 below; the other eight wait for a check, an answer or a later slot |
| Waiting for the owner's answer | 12 |
| Waiting for a design round with the owner | 2, and the second half of a third |
| Waiting for a hands-on check | 7 |
| Left for later, with the reason | 6 |

A further 247 tracker rows were read as candidates and stay in the tracker.

## Design

### The wave's laws

These bind every child. [binding: they are the owner's standing positions and rulings, and each child would otherwise re-derive them differently]

1. **Claude Desktop is the benchmark** (charter D-14 and D-20 as amended 2026-11-12): where an item follows engine behaviour or a basic surface, it is built the way Claude Desktop `app-5.1231.2` builds it, read in its source and cited as `research/SOURCES.md` prescribes. The Claude Code CLI `2.1.322` is the reference for how the engine itself words and delivers things. An item that departs from Claude Desktop on purpose says so and says why.
2. **A pure mods client.** MAWS draws what the engine and the user's mods produce, and adds no drawing of its own in their place. Where no mod can draw (law 5), MAWS mirrors the mod's rule and says which rule it mirrors.
3. **Less on screen.** A row, a label or a card that does not earn its space goes. No setting is added where one behaviour serves.
4. **No complexity for a small gain.** When the grounding found an item larger than it reads, the item's section says so and the cheaper route is taken unless the owner asked for the larger one.
5. **Three routes, one behaviour.** A session reaches the window by one of three routes, and many of the wave's defects exist on one route only. Every item that touches the transcript, the requests or the composer states what it does on each route, and "not on this route" needs a reason:
   - **a session MAWS runs** (in code: lane B): MAWS launched the engine headless and drives it over its wire through the engine host; the user's mods can draw here.
   - **a terminal session** (lane A): the engine runs in a terminal; MAWS watches it through the sminos bridge and reads its transcript file. No mod draws here.
   - **a session on another machine**: either kind, reached over the machine link through that machine's daemon (`mawsd`); drawn from transcript rows. No mod draws here.
6. **The engine is not guessed at.** A claim about what the engine sends is verified against `spikes/protocol-probe/fixtures/` or a new probe on engine `2.1.322` before code depends on it (CLAUDE.md, working rules). The children name their probes.
7. **Visual language is not this wave's.** Rounder geometry, materials and colours are being designed elsewhere and come after. A child uses today's tokens and shapes; an item that is only visual language is handed to the renewal.
8. **Keep means keep.** A child that would change a behaviour the owner marked `keep` stops and reports.

### Words used in this document

- **Request:** something a session needs from the person before it can go on or finish: a permission prompt, a question (the engine's AskUserQuestion, MAWS's own ask tool, the sminos ask tool), a plan to approve, a trust decision. In code a request is an *attention item* (`src/shared/attention/`).
- **Arrival:** anything that enters a session other than the person's typed prompt: a message from another session or a subagent, a background task's notification, a scheduled trigger, an answer to an asynchronous question, a slash command's output.
- **Tool run:** consecutive tool calls with no text between them, drawn as one group.
- **The to-human view:** the report the to-human mod draws: the agent's messages to the person, with the work between them folded under "working record".
- **Card column:** the right-hand column of cards beside the transcript (Environment, Context, Artifacts and others). **Side surface:** a tool opened beside the transcript (Review, Files, Terminal, Browser, Source control). **Main tabs:** the tab strip over the main area.
- **The machine link:** the connection from this window to another machine's daemon; an *offer* is an act that machine accepts over it (`src/endpoint/offers.ts`).

### The owner's answers of 2026-11-12

Eight questions were put to the owner as cards; the answers are recorded verbatim beside the register. In short:

- **The to-human view:** the mod draws first, and MAWS mirrors it. The mod draws in sessions MAWS runs; in terminal sessions and sessions on another machine, MAWS applies the mod's fold rule itself. The mod change the owner ruled on 2026-10-24 (the unmerged doperpowers branch `to-human-draw-in-maws`) is rebased by this wave and merged by the owner. (U2)
- **Thinking:** its own step, in order, inside the tool run. Two conditions from the owner: thinking keeps the shape it has today and does not look like a tool row; and an opened run must not grow too long. (U2)
- **Where a request is drawn:** in the transcript, with the composer free: a question in the row of the call that asked, a permission prompt at the transcript's end. The owner added a queue of what waits, in the card column, and confirmed this reading. The jump-to-latest button says when a request waits. (U1)
- **Tabs:** one strip for everything open, across projects and machines, restored after a relaunch; no hidden per-project sets. A group is then a named set of sessions opened as tabs. (U13)
- **Settings, Customize and the Library:** a page that replaces the main area with the sidebar kept, as Claude Desktop does; not a tab, not a window. (U7)
- **Background work in the card column:** two cards, Subagents and Background tasks, each present only while it has something running. The owner added: Subagents is a tree that lists the first level and opens a nested agent when its parent is clicked. (U8)

Eleven smaller questions are asked when their child starts; each is named in that child's section and under Deferred.

## Children

The sections U1 to U14 rely on the cross-child contracts that follow them. Items are named by their register ids: `l<n>-…` a mark on the comparison, `O-nn` an observation, `#nnn` a board ticket, `S-nn` a sitting finding, `X-nnn` a tracker row.

| child | surface | items it builds | grain |
|---|---|---|---|
| U1 | Requests: permission prompts and questions | l4-approvals-07, #358, S-04, S-07, O-22, O-21, l4-approvals-08 (with l2-transcript-16), O-17, l2-transcript-10, l4-approvals-02, l4-approvals-04, O-23, l4-approvals-05, l4-approvals-11, l4-approvals-13, l4-approvals-12, l4-approvals-09, #333 | plan |
| U2 | Transcript structure: tool runs, thinking, the to-human view | O-29 (with O-26), O-27 (with O-25), O-15, #479, #351, l6-artifacts-12, O-49, O-13 (with O-06, l2-transcript-06), O-30, #332, l2-transcript-04 | plan, after a drawn example the owner looks at |
| U3 | Transcript rows: arrivals, messages and blocks, find and navigation | O-12, O-28, O-34, O-41, X-032, O-07, O-08, O-02, l2-transcript-07, O-18, #331, #146, l2-transcript-08, l2-transcript-09 | plan |
| U4 | Composer | l3-input-01, -02, -03, -04, -05, -08, -15, X-049, l3-input-06, -07, -09, -10, -12, -14, O-32, O-20 | plan |
| U5 | Review, comments and source control | O-45, l6-artifacts-05, l6-artifacts-19, l6-artifacts-20, l5-code-01, l9-browser-delivery-05, X-216, X-218, l5-code-05, l5-code-03, l5-code-04, l5-code-12, X-072, l5-code-02, l5-code-06 | plan |
| U6 | Files, links and the keyboard | l5-code-11, l5-code-09, l5-code-10, l9-browser-delivery-08, O-37, l9-browser-delivery-03, l5-code-08, l7-shell-06, l7-shell-07, l7-shell-08, l7-shell-09, l7-shell-13 | plan |
| U7 | Sidebar, title bar and destinations | S-11, O-16, O-38, #559, #407, O-03, O-47, O-40 | plan |
| U8 | Card column, background work and the working folder | O-10, X-165, O-05, O-09, #359, X-168, l5-code-16, l5-code-14 | plan |
| U9 | Sessions on other machines | O-11b, O-39, #563, #565, S-05, O-48, S-02, S-01, S-13 | plan |
| U10 | Artifacts | l6-artifacts-07, X-141, O-43, l6-artifacts-08, l6-artifacts-15, l6-artifacts-18, l8-settings-13 | plan |
| U11 | Settings, connectors and the Org pages | l8-settings-01, l8-settings-03, l8-settings-04, l8-settings-06, #540, #523, #505, #456, S-09, S-10 | plan |
| U12 | In-app browser, computer use and delivery | l9-browser-delivery-01, -02, -06, #435, l9-browser-delivery-07, l9-browser-delivery-09 | plan |
| U13 | Tabs, New chat and session groups | O-01, O-31, #497 now; the groups half of O-31, O-42 and O-24 after a design round | plan for the one strip; design with the owner for groups |
| U14 | Checks on the owner's machines | S-03, l6-artifacts-13, O-33, l5-code-07, #429, S-08, #476, and the reproductions other children name | spike (findings) |

<!-- CHILD SECTIONS -->

## Cross-child contracts

Each contract names its owner (the child whose landing defines it) and the children it binds. The owner's section carries the content; the others code against it and do not re-decide it.

**UC-1 · A request waits only until it is answered.** Owner U1; binds U3, U7, U8, U9. A request counts as waiting, everywhere it can show (the request's own card, the session's row and tab, Needs you, badges, notifications, the feed another machine reads), only until the person answers it. Once answered it raises nothing, whether or not the engine has yet confirmed the tool's first frame. Today `isOpen` in `src/shared/attention/kinds.ts` counts an answered, unconfirmed request as open, against charter §4.6 ("delivered is not an alarm state"); this one cause produced #358, S-04, S-07 and X-066. U1 defines the predicate; no child adds a second definition of "waiting".

**UC-2 · One reading of every arrival.** Owner U3; binds U1, U2, U4, U9. One reader under `src/shared/` classifies what enters a session other than the person's typed prompt, and every route uses it: the engine host's normaliser for the live wire, the transcript-file backfill, and the reader for another machine's rows. The same arrival draws the same row on every route. Classes, at least: a peer session's message; a subagent's message or hand-back; a background task's notification, by outcome; a scheduled trigger; an answer to an asynchronous question; a slash command's output; the person's own steer delivered by a fallback route (which stays the person's). Arrivals are drawn as one line each, in the CLI's wording (U3 carries the forms). U1 consumes the "answer to a question" class to fill the question's row; U4 consumes it to word a waiting answer; U2 consumes the classes to decide what the to-human view folds and how a turn the person did not start is named.

**UC-3 · The transcript's model has one writer at a time.** Owner: the wave's architect; binds U1, U2, U3. `src/renderer/src/transcript/model/` is changed by three children. U3 lands its arrivals first. U2's grouping and fold work starts from a master that contains it. U1 draws requests in the transcript through row kinds it owns and leaves grouping to U2: a request's row always breaks a tool run and is never folded while it waits. U2 owns `groups.ts`, the group row and `src/renderer/src/owner/`; U3 owns the arrival and message rows; U1 owns the request rows.

**UC-4 · The session's working folder.** Owner U8; binds U5, U6. *The working folder* is where the agent is working now: the launch folder until the engine reports that the agent moved (into a worktree it made, or elsewhere), then that folder. One selector answers it. Review, Source control, Files, the terminal's starting folder, "Open in" and the Environment card read the selector, and none reads `record.worktree?.path ?? record.directory` itself (28 places do today). U8 lands the selector with today's behaviour first, as its own small pull request, so that U5 and U6 build on it; the live signal follows after U8's probe of what the engine reports.

**UC-5 · One comment card.** Owner U5; binds U10, U12. A comment on a document, an HTML page, a diff in Review or a page in the in-app browser is written in the same card with the same draft model. The card has one destination control, a "Send to main" checkbox, unchecked by default except in Review; unchecked, the comment opens a side thread. Several comments made in one pass are sent together. A draft survives the card closing. A sent comment names the session it went to.

**UC-6 · One keymap.** Owner U6; binds every child that adds a chord. The table below is the authority for the wave's new default chords; a child adds its own actions to `src/shared/keymap/actions.ts`, and U6's shortcut sheet and menus are drawn from that table, so they need no second list. Existing chords do not move (⌘0 Overview, ⌘K palette, ⌘L focus the composer, ⌘. stop, ⇧⌘J next Needs you, ⌘/ shortcuts, ⌘B, ⇧⌘B, ⌘\). ⌘F acts on the focused region: the transcript's find when the transcript or composer has focus, the editor's own in a file, the page's in the browser.

| action | default chord | child |
|---|---|---|
| Send | Enter, always | U4 |
| New line | Shift+Enter, Option+Enter | U4 |
| Queue for after the turn | ⌘Enter while a turn runs; sends when idle | U4 |
| Take back the last waiting message | ↑ in an empty composer | U4 |
| Model menu / effort / mode menu | ⇧⌘I / ⇧⌘E / ⇧⌘M | U4 |
| Search prompt history | Ctrl+R, composer focused | U4 |
| Find in session; next, previous | ⌘F; ⌘G, ⇧⌘G | U3 |
| Previous, next prompt | ⌥⌘↑, ⌥⌘↓ | U3 |
| Terminal / Review / Files | ⌘J / ⇧⌘D / ⇧⌘F | U6 |
| Go to file | ⌘P | U6 |
| Attach selection to chat | ⇧⌘L | U6 |
| Back, Forward | ⌘[, ⌘] | U6 |
| Zoom in, out | ⌘=, ⌘−; Actual Size has no chord | U6 |
| Keys on a permission prompt | U1's section | U1 |

**UC-7 · An act on a session works on another machine, or says why not.** Owner U9; binds U1, U3, U4, U12. `src/endpoint/offers.ts`, `src/main/lane-b/remote.ts` and `src/shared/ipc/remote-unavailable.ts` are U9's files. A child that adds or changes an act on a session (send now, fork from a message, dismiss, show a pane) states what happens for a session on another machine: it works, through an offer U9 adds, or it is refused with a sentence that names the reason. No act fails silently and none is drawn enabled where it cannot work. Fork is one act with an optional message to fork from; U9 owns it for local and remote sessions, and U3 and U4 mount it.

**UC-8 · Shared files have an owner.** Binds all. A child that must edit a file another child owns keeps the edit to the smallest insertion and rebases onto the owner's landing. Owners: `src/renderer/src/sidebar/` and `src/renderer/src/app/Toolbar.tsx` U7; `src/renderer/src/panel/summary/` and `src/renderer/src/tools/agents/` U8; `src/renderer/src/composer/` U4, except `composer/docked/` U1; `src/renderer/src/request-card/` U1; `src/renderer/src/transcript/` per UC-3; `src/renderer/src/tools/code/` and `src/renderer/src/side/card/` U5; `src/renderer/src/main/` (the tab strip and its model, `stores/layout-model.ts`) U13, except `main/Pane.tsx` U9; `src/shared/keymap/` and `src/main/menu.ts` U6; `src/renderer/src/settings-tab/` U11; `src/shared/maws/instructions.ts` and `tools.ts` are edited by several children, one sentence or one tool each.

**UC-9 · What the card column holds.** Owner U8; binds U1, U7. U8 owns which cards the column shows and when: Environment (open by default) and Context always; Subagents, Background tasks and the queue of waiting requests only while each has something to show; Artifacts behind the column's three-dot menu. U1 supplies the content of the waiting-requests card and U8 its place and its presence rule. A card that has nothing to show is absent, not empty.

**UC-10 · Building and landing.** Binds all.
- **Base.** Every child branches from a master that contains the project registry's app branch (`registry-app`), which changes 54 renderer files including the sidebar, New chat and `sessions/actions.ts`. Until it lands no child branches.
- **Where work happens.** A child is built in a git worktree on a branch `ux-wave/<child id>` and opens one pull request, or several where its section names an early one.
- **This MacBook.** No local typecheck, no multi-file eslint or vitest, and no local Electron on the owner's MacBook, at any load: one-file eslint and one-file vitest only. Typecheck, lint, the unit suite and the probes run on GitHub Actions through `scripts/ci-gate.sh <worktree>` (class 1a); Electron e2e groups run on a Mac under the load rule; a new or reworked e2e scene runs alone on a Mac before a final gate.
- **Review.** Each child's execution document gets an adversarial review before its executor starts. Each branch gets `doperpowers:review-code` before it lands: the panel (xhigh) for a branch of panel size or a delicate change, a single reviewer otherwise.
- **Landing.** Nothing lands on master, and no build of the wave reaches the owner's machines, without the owner's word; the machines stay on build F until P5's verdict. A child's pull request is reviewed and landed by the session that keeps master (the P5 architect at this writing), by its gated merge: a merge commit built with `git merge-tree`, class 1a green on that exact tree, master unmoved, then the push.
- **The record.** A child's pull request carries the edits to the documents its items amend: each reversed ruling amended where it stands, dated, naming the owner's words (Decision Log, "Rulings reversed"). At landing the register's rows are updated, and the board tickets and tracker rows the child closes are closed through the board scripts.

**UC-11 · The repository is public.** Binds all. No screenshot of the owner's, no text of the owner's sessions, no account name and no email address enters the repository, a pull request or a ticket. The comparison's screenshots, the grounding files and the vendor's sources stay outside it.

## Ordering and dependency map

- **Before anything:** `registry-app` on master (UC-10).
- **First, in parallel:** U3 (its arrivals reader first, UC-2), U4, U9, U8 (the working folder's selector first, UC-4), U13's one strip, and U1's work that does not draw in the transcript (UC-1, the cards' contents, approving from outside).
- **Then:** U1's placement in the transcript and O-21 (after U3's reader, and after U8 gives the card column its slot for the queue, UC-9); U5 and U6 (after U8's selector); U7 (after U13's strip model, because a page that replaces the main area and the strip are one layout); U2's MAWS work (after U3's arrivals, after the owner has looked at the drawn example of an opened tool run, and after the owner merges the mod's pull request for the part that depends on it).
- **Any time:** U10, U11, U12 touch separate code.
- **U14** needs about forty minutes of the owner's time on their machines, or an agent on the mini where a check needs no person; its findings feed U7 (S-03), U13 (l6-artifacts-13), U3 and U9 (O-33, O-35), U5 (O-46) and U10 (l6-artifacts-09).
- **U13's groups** start with a design round: drawn examples of a group opened as tabs, the sidebar's views (O-42) and the folded sidebar (O-24), put to the owner before anything is built.
- **Engine probes** (law 6) come first inside their children: send-now on a running command (U4), what the engine reports when the agent changes folder (U8), a classifier block on MAWS's own wire (U1).

How many children run at once is decided at dispatch, against the shared GitHub Actions budget and the review load.

## Risks and mitigations

- **A fix that is not a clear improvement.** Mitigation: Parent-level acceptance 2; each child's section names what the owner will see, and a child whose result is doubtful shows it to the owner before landing.
- **Three children in the transcript's model.** Mitigation: UC-3's order and ownership.
- **The registry branch moves the base.** Mitigation: UC-10's base rule; the sidebar items were grounded against that branch's diff and are re-read at dispatch.
- **An engine behaviour assumed, not seen.** Mitigation: law 6 and the three probes; an item whose probe fails falls back as its section says.
- **Reversing earlier rulings silently.** Mitigation: the Decision Log's list and Parent-level acceptance 4.
- **Review and CI load from thirteen children.** Mitigation: staged dispatch; the class 1a gates run off this MacBook.

## Deferred and out of scope

**Waiting, inside this wave** (each joins its child when its condition is met; the register holds every row):

- For the owner's answer, asked when the child starts: tabs in the side column instead of stacking (O-36; U13); the next-step suggestion (l2-transcript-13, l3-input-11, l6-artifacts-11; U4); the question tool for sessions MAWS runs (O-19, #420, with #421 after it; U1); Customize's structure and icons (O-14; U11); where a default model and mode are written (l8-settings-11; U11); PDF preview (l6-artifacts-01; U6); what an artifact link opens (O-44; U6); Korean typing (l6-artifacts-14; U10); Touch ID for a machine's connectors (#455; U11).
- For a design round with the owner: session groups, the sidebar's views and the folded sidebar (O-31's second half, O-42, O-24; U13).
- For a hands-on check (U14): S-03, l6-artifacts-13, O-33, l5-code-07, #429, S-08, #476, and the reproductions of O-46, O-35 and l6-artifacts-09, whose fixes are decided and follow the check.
- For other items: X-184, l8-settings-05, l8-settings-07 (U11, after O-14 and #476); l6-artifacts-16 (U10, last).

**Deferred, may return:** a reader's grade before the first send (#526, X-237); pop-out windows (l7-shell-10; the owner chose a page for O-40); a project settings page (l8-settings-12, after the registry); Drive through a connector (#400). The 247 tracker candidates not taken stay in `docs/tech-debt-tracker.md`.

**Handed to the visual renewal:** roundness of tabs and older components (O-04), row alignment on the Org People page (#342), the thinking mark (PR #144, rebased after U2).

**Out of scope, standing:** desk web; a chapter rail in the transcript; a site-permission prompt in the in-app browser; hunk staging; a bottom terminal drawer; an agent tool that reads the person's terminal; Read aloud and ratings on answers. Each is recorded with its reason in its item.

## Tracking map

| child | execution document | ledger or findings | status |
|---|---|---|---|
| U1 | — | — | not dispatched: waits for `registry-app` on master and the owner's word to build |
| U2 | — | — | not dispatched: the mod's rebase and the drawn example come first |
| U3 | — | — | not dispatched: as U1 |
| U4 | — | — | not dispatched: as U1 |
| U5 | — | — | not dispatched: blocked by U8's selector |
| U6 | — | — | not dispatched: blocked by U8's selector |
| U7 | — | — | not dispatched: blocked by U13's strip model |
| U8 | — | — | not dispatched: as U1 |
| U9 | — | — | not dispatched: as U1 |
| U10 | — | — | not dispatched: as U1 |
| U11 | — | — | not dispatched: as U1 |
| U12 | — | — | not dispatched: as U1 |
| U13 | — | — | not dispatched: as U1 for the one strip; groups wait for the design round |
| U14 | — | — | not dispatched: waiting for a sitting |

## Surprises and discoveries

From the grounding (2026-11-12); each is cited in the item it changed.

- Observation: four items about requests that keep "waiting" after they were answered have one cause.
  Evidence: `src/shared/attention/kinds.ts` `isOpen` is `pending || delivered`; `src/engine-host/broker.ts` `confirm()` leaves `delivered` only at the first frame that names the tool use; charter §4.6 says delivered is not an alarm state.
- Observation: the to-human mod draws nothing inside MAWS, and the change the owner ruled on 2026-10-24 was never merged.
  Evidence: the mod's render hooks return early when `MAWS_NATIVE_TO_HUMAN` is set (`src/shared/owner/contract.ts` advertises it); doperpowers branch `to-human-draw-in-maws` (`d17d9b73`, 2026-10-23) is not an ancestor of its `main`.
- Observation: thinking reads out of order because of the fix of 2026-10-23 that flattened tool groups.
  Evidence: commit `5ab559bcd`; `src/renderer/src/transcript/view/rows/Group.tsx` draws a group's thinking after all its calls under "Internal activity".
- Observation: clicking a project does not start a session; the title bar's project chip does.
  Evidence: `src/renderer/src/app/Toolbar.tsx`, the chip's click calls `createSession(project.id)`; a sidebar project row only selects and expands.
- Observation: Claude Desktop opens Settings as a page with the sidebar kept, not as a floating window.
  Evidence: `app-5.1231.2/main-process/index.chunk-BV3uOqbK.js` dispatches navigation to `/settings/…`; `settings` is a route under `_withSidebar` in `web/app/v1/index-m4Lmn-QT.js`.
- Observation: "Send now" stops a running command only because MAWS sends a plain interrupt; the engine can now move the command to the background instead.
  Evidence: `~/claude-code-bundle/2.1.322/cli.pretty.js` sends `interrupt` with `send_now: true` and a `message_uuid`; `src/renderer/src/composer/queue/QueueList.tsx` calls `controls.interrupt({cancelEngineQueued: false})`.
- Observation: once the agent moves into a worktree, every code surface keeps reading the launch folder.
  Evidence: 28 non-test places read `record.worktree?.path ?? record.directory`; nothing under `src/` handles a change of the engine's folder.
- Observation: a failed background task raises an error card because every failed task notification becomes an error item.
  Evidence: `src/services/attention/service.ts`, the task-notification branch.

## Decision Log

- **2026-11-12 · Verification.** This document: one independent review of the design and the cut by a frontier-model reviewer, and one adversarial review of the cut, the contracts and the edges for buildability; findings are judged, not adopted wholesale. Each child's execution document: an adversarial review before its executor starts. Each branch: `doperpowers:review-code`, the xhigh panel for a branch of panel size or a delicate change, a single reviewer otherwise. A new or reworked e2e scene: run alone on a Mac before the final gate. The wave: the owner's sitting (Parent-level acceptance 2).
- **2026-11-12 · Scope.** Tracker rows enter the wave only when they ride with an item (13 of 260 candidates); desk web's candidates stay out; the visual renewal takes O-04, #342 and PR #144. Rejected: taking every tracker row that touches a surface, which would have doubled the wave with rows nobody asked for.
- **2026-11-12 · The owner's answers** to the eight first questions, as summarised under Design and recorded verbatim beside the register. On placement the owner picked no option and wrote an addition; the architect's reading of it was put back to the owner and confirmed the same day.

**Rulings reversed.** A later word of the owner's wins over an earlier ruling; each reversal is recorded in the document that held the ruling when the change lands (Parent-level acceptance 4). The items' sections carry the reasons.

| item | the earlier ruling | child |
|---|---|---|
| l3-input-03 | 2026-10-01, W10: "no hold option, no ⌥Enter and no send menu" (charter §4.2, §5.4) | U4 |
| l3-input-05 | 2026-10-01, W1: queued and steered messages drawn as dimmed bubbles at the transcript's tail (charter §4.2) | U4 |
| l3-input-10 | W3: the mode menu's order (charter §5.4) | U4 |
| l3-input-14 | W3: the model chip reads "<alias> <effort>" (charter §5.4) | U4 |
| l3-input-06 | W3: slash commands listed "with their hints" (charter §5.4) | U4 |
| l3-input-08 | charter §5.8: ⌘Enter sends a multi-line draft | U4 |
| l3-input-01 | charter §4.2: "now" preempts the turn | U4 |
| O-08 | 2026-10-01, W2: code blocks and tables break out of the text column | U3 |
| O-02 | W2: message actions beside the bubble | U3 |
| O-41 | P4 DC9 M6: a peer's delivery drawn as a bubble labelled "From X" | U3 |
| O-12 | P1 E7: peer messages stay in view through a fold | U3 |
| O-29 | the fix of 2026-10-23 for l2-transcript-01, which flattened tool groups | U2 |
| l5-code-11 | charter D-8: main tabs hold file viewers | U6 |
| l5-code-02 | the accepted proposal for a commit dialog with a generated message | U5 |
| S-07 | C7's rule: an answered card stays docked until its tool confirms | U1 |
| O-45 | X10: the comment card's two-way destination control | U5 |
| l6-artifacts-08 | X9 as written, if a design system must bind at creation | U9 |
| S-11 | P4 W11 I1: the prompt as a new session's provisional title | U7 |
| O-01 | 2026-10-01, I3, and charter §5.2 W12: a tab set per project | U13 |
| O-05 | 2026-10-24, D4: Artifacts as a default card | U8 |
| O-40 | Settings, Customize and the Library opening as tabs (as built) | U7 |

Waiting on an answer and so not yet reversed: O-36 against the answer of 2026-10-24 (a second side surface stacks under the first); O-44 against X9 (the agent may open an artifact pane).

## Outcomes and retrospective

Pending — written when the unit closes. Closing is a recomposition check: verify Parent-level acceptance as written, then retrospect.
