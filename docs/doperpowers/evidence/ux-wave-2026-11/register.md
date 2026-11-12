# The UX wave: register of items

Every item the wave considered, one row each: where it came from, its state, and the line it was given when the cut was put to the owner (so "you" in a line is the owner). Kept beside `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, which cites the items by these ids. Generated from the wave's cut on 2026-11-12; the architect regenerates it when a state changes.

240 items: 145 to build (136 of them in children now), 11 questions to the owner, 2 for a design round, 7 hands-on checks, 25 already built, 23 keep, 13 the same ask as another item, 4 not MAWS's to fix, 3 handed to the visual renewal, 7 later.

Ids: `l<n>-…` a mark on the comparison of 2026-10-23, `O-nn` an observation, `#nnn` a board ticket, `S-nn` a finding from P5's sittings, `X-nnn` a tracker row that rides with an item.

## The owner's answers of 2026-11-12

Verbatim, as chosen on the question cards; a note is the owner's own text.

| question | the owner's answer | the owner's note |
|---|---|---|
| How should MAWS show the to-human view? | Mod first, MAWS mirrors (Recommended) |  |
| Who lands the mod change you ruled on 10-24 (the unmerged doperpowers branch to-human-draw-in-maws)? | I rebase, you merge (Recommended) |  |
| Where should thinking sit among the tool calls? | Own step, in order (Recommended) | my concern for this case that this may make the tool use block too long. and also want to make thinking not like tool use block, keep it a same shape, just different position.. |
| Where should a waiting permission prompt or question be drawn in its session? | (no option selected) | + on the right side spade we can show like pending question queue (like sminos AskUserQuestion mcp tool does, so that when the question is above the transcript, user can still find them from the question queu) |
| Is this reading of your note right: requests drawn in the transcript with the composer free, plus a card in the right-hand column listing what waits? | Yes, that reading (Recommended) |  |
| When a request waits out of view, where should that show in the session? | On the jump button (Recommended) |  |
| What should a tab strip hold? | One strip, restored (Recommended) |  |
| How should Settings, Customize and the Library open? | A page, like Desktop (Recommended) |  |
| How should Settings, Customize and the Library open in MAWS? (Asked again: my first card was wrong about Claude Desktop.) | As Desktop really does (Recommended) |  |
| How should running background work show in the right-hand cards? | Two cards, while running | and subagents as tree too (progressively disclosed. take account for nested ones. ( i won't list everyagent as default, list depth 1 as default and let nested ones to be opened when clicked) |
| Today a second side surface opens under the first (your ruling of 10-24). In O-36 you wrote "I'd tab-erize all". In this wave a file opens in the side column (your mark on l5-code-11), so stacking would happen more often: a file opened from Review would sit under the diff. Should side surfaces be tabs instead? | Tabs beside the chat (Recommended) | But also allow dynamic stacking -- does not have to be either/or does it? make the panel's attribute to be a tab, but they can be splitted, stacked, and so on |
| When a background task fails, should anything besides its line in the transcript tell you? | Only the line (Recommended) | Same with Claude Code Terminal |
| When your message has waited three seconds behind a command the agent is running, should MAWS move that command, or a subagent call the agent is waiting on, to the background by itself so that the agent reads the message? | Only on Send now (Recommended) |  |
| While a question from the agent waits, if you send a message instead of answering it, should the message count as its answer? (The first card. Its sentence on Claude Desktop was wrong, and the question in the next row replaced it.) | No, it keeps waiting (Recommended) | Separate 'dismiss' button can dismiss question how about that, just like mcp__sminos__AskUserQuestion does |
| While a question waits, what should a message you send from the composer do to the question? (Asked again: I wrote that Claude Desktop marks such a question "Replied in chat". That is its layout behind a server switch. By default Desktop dismisses the question when you send, and it then reads "Not answered".) | (no option selected) | we uses diffent question too. -- Desktop's is not async while ours allows async. message sent from composer stil delivers. If that answers the question, then user can just dismiss the question card. if the question still need to be answered, then the async questoin is still there, so user answers that. does this provides answer? |
| What should the tab of a session on another machine say while the link is not up? (Your ruling of 10-27: "offline" for every such state, rows greyed.) | Three states (Recommended) |  |
| In an opened tool group, how many thinking lines should show? (The first card. It assumed that few thoughts have text, and the question in the next row replaced it; the option chosen here does not carry over.) | Text, or 10 s and more (Recommended) | + just stream "thinking wiht ~effort for X min S secxx" when that's the current activity. I guess the past thinkings are not as importatnt |
| In a session MAWS runs every thought has text, because MAWS asks the engine for thinking summaries (85 of 85 thoughts in its journals of 10-31 to 11-12; about two thoughts for every three tool calls). When a tool run is opened, which thoughts get a "Thought for Ns" line among the calls? | 10 s and more (Recommended) |  |
| Should a long opened tool run be bounded in height? | No, full height (Recommended) |  |
| In the folded to-human view, should the turn line ("Worked for …") stay in view? | Only with a record open (Recommended) |  |

## Questions still open

A question is put to the owner when its child starts, unless the last column says otherwise. The last twelve were raised when the spec was assembled or after it.

| items | question | recommended answer | when |
|---|---|---|---|
| l2-transcript-13, l3-input-11, l6-artifacts-11 | Do you want the engine's next-prompt suggestion (grey ghost text in the composer, Tab accepts; one extra model call per turn)? | Do not build it now; log it as debt, as you said for l2-transcript-13. | when its child starts |
| O-19, #420 | Is one ask tool for both the terminal and MAWS still the direction, given it needs sminos changes and a new answer path? | Two steps: first load MAWS's own ask up front with non-blocking as its default; then the sminos route, if you want one tool everywhere. | when its child starts |
| O-14 | In Customize, which level is on the outside? | My items / Discover outside, with the kind (plugins, skills, connectors) as a filter inside: your second and fourth sentences. (Claude Desktop has the code for such a merged page but ships it switched off for every account in 5.1231.2; what it ships has the kind outside.) | when its child starts |
| O-14 | May MAWS fetch connector icons from Google's favicon service (it tells Google which connector sites you list), behind a switch? | No fetch; every item without an icon gets a generated letter tile, which is your "just create one". | when its child starts |
| l8-settings-11 | Should "make this the default" write your Claude Code settings files (so the terminal agrees), or stay a default MAWS keeps for itself? | Write the Claude Code user settings for model and permission mode: one default everywhere, which is what your option B wanted. | when its child starts |
| l6-artifacts-01 | Do you want files the agent writes to open inside MAWS? | PDF only, now. | when its child starts |
| O-44 | What did "opens the artifact on the new path" mean, and where should a click on an artifact link open it? | Keep opening it in the session's side panel. | when its child starts |
| l6-artifacts-14 | Have you ever lost a first letter or a jamo while typing Korean yourself in a deck or document? | If not, the tracker row closes as not reproduced. | when its child starts |
| #455 | Reading another machine's connectors asks for Touch ID each time. Which? | Make that read need no Touch ID for someone who already administers the machine. | when its child starts |
| #420 | Defer the edit tools behind tool search again (about 7 s on a session's first edit, for about 2,900 tokens of context)? | No: keep them loaded. | when its child starts |
| O-01 | After a relaunch, should a New chat tab with nothing typed in it come back? | No: only a chat with a draft or a started session returns. | when its child starts |
| l9-browser-delivery-01 | When the Browser opens by itself because the agent started acting in it, should it show the agent's tab? | Yes, unless you are using the tab that is selected. | when its child starts |
| O-37 | On this Mac, should a file the agent linked in a session's transcript open read-only on click when it lies outside that session's folders? | Yes, limited to files that session's transcript links to, checked by the main process against the transcript. | when its child starts |
| #476, l8-settings-05 | Where should a per-chat connector switch sit, and does the Settings connector list go once "Add custom connector" moves to Customize? | Put to you with the result of the hands-on check of #476, which shows which switches can act on a running session. | after the hands-on check of #476 |
| l5-code-01, l9-browser-delivery-05 | In Review and the in-app browser, should opening a second comment keep the first one unsent, so that they are sent together? | Yes: the card lists the others and Send reads "Send N comments". | when its child starts |
| l5-code-02 | Where should the buttons that ask the agent to commit, push and open a pull request sit? (Claude Desktop has one button whose meaning follows the state: Commit only where the folder has no GitHub repository, otherwise Create PR, which commits and pushes as part of its prompt.) | All three in Source control, and one next-step button on the Environment card; all off while the agent works. | when its child starts |
| l6-artifacts-20 | On 10-23 you marked "keep" on the export dialog always starting in Downloads, and "fix" on the finding that asks it to remember the last folder. Which holds? | Remember the last export folder. | when its child starts |
| O-48 | Should "End session" (stop the process without archiving) exist for a session on another machine? | No: Stop ends a turn and Archive ends the process. | when its child starts |
| l9-browser-delivery-09 | May the Drive check create two small files in your Google Drive (removed afterwards)? | Yes. | when its child starts |
| O-36 | Your note on side tabs asks for tabs and for stacking when you want it. Is the shape: tabs with one in view, and a second group of tabs that you can make under the first (two groups at most, as the main area splits in two)? | Yes: tabs, plus one group below on demand. Side by side is done by dragging a file or an artifact to the main area. | asked on 11-12, after your answer on side tabs |
| O-27 | What should the line of a thought in progress read? Today it reads "Thinking with high effort · 1m 12s" only until the thought's summary has a line, then the summary's latest line (your ruling of 10-24); in a session MAWS runs that is almost at once. Your note of 11-12: just stream "thinking with ~effort for X min S sec" when that's the current activity. | The label only, for as long as the thought runs; the summary is read by opening the line. This reverses the 10-24 ruling. | asked on 11-12, after your note on the first "Thoughts" card |
| l9-browser-delivery-01 | Which computer-use ticket did you mean by "the ticket is already registered" (the in-app browser as a surface of the computer-use tool)? | If you do not recall it, a new ticket is filed on the computer-use plugin's board. | when its child starts |

## Decisions the sections made that the owner may see differently

Each goes beyond the line the owner was given. They were listed for the owner with the spec on 2026-11-12; an answer that differs is recorded in the spec's Decision Log and the child's file is revised.

| child | item | what the section decided | what it could have been |
|---|---|---|---|
| U1 | l4-approvals-02 | With a permission prompt in view, ⌘↩ (empty draft), ⇧⌘↩ and Esc answer it even while the cursor is in the composer; ⌘. stays Stop. Claude Desktop's rule and guards. | Keys act only once the prompt has focus. |
| U1 | l4-approvals-02 | The third button gives the lasting scope: "Always allow in <project>" where the engine suggests a rule (written to the project's local Claude Code settings, the file named under the buttons), else "Allow for this session". | A list of scopes, as today. |
| U1 | l4-approvals-08 | The "Waiting for you" card lists every waiting request, permission prompts included, and holds no answer buttons: a line scrolls to the request. | Questions only; or answer buttons on the card. |
| U2 | O-29 | Bookkeeping calls that are hidden today (todo updates, entering a worktree, entering plan mode) become ordinary steps of an opened group; nothing is hidden inside a group. | Keep them hidden. |
| U2 | O-29 | A tool run that holds a call waiting for your approval stays folded; its line reads "Waiting for approval: `cmd`" in the warning tone, and the prompt is answered at the card at the transcript's end. Claude Desktop's default renderer keeps the run folded too; its newer renderer, behind a server switch, opens the run while the call waits. | The run opens by itself while a call waits and returns to how you left it after the answer. |
| U4 | l3-input-02 | After a Stop, messages that were waiting stay held until you press Resume. Claude Desktop lets them run: its Stop is a plain interrupt and the next waiting message starts at once. MAWS keeps the hold because a Stop that is followed at once by the next waiting message does not stop the agent. | As Claude Desktop: the waiting messages run after a Stop. |
| U2 | O-15 | The turn line carries a caption of the whole turn in Claude Desktop's words, three parts then "and N more actions". On the turn line the parts for changed files come first, then agents, then the rest; a tool run's own caption keeps Desktop's order (the order each kind first happened). Taken from the drawn example and told to you on 2026-11-12. | Desktop's order on the turn line too; no cap; or largest first. |
| U3 | O-12 | A peer's or a subagent's message folds with its turn, the one that opened the turn included; a task's line with an outcome stays in view through a fold in the full transcript. | The opening message stays above the turn line. |
| U4 | l3-input-01 | Esc in the composer sends the first waiting message now, else stops (your words of 10-01; Claude Desktop's Esc takes back the newest next-step message and stops when there is none). ↑ is the one key that takes a waiting message back. | Esc takes the newest next-step message back, and otherwise stops, as Claude Desktop. |
| U4 | l3-input-04 | Edit puts a waiting message back into the composer; the inline row editor goes. The stack folds at three rows and has no drag reorder. | Edit in place. |
| U4 | O-20 | The /btw card sits at the foot of the card column, or over the pane's corner when the column is not drawn; the Side pane loses its question view. | A fixed corner card only. |
| U5 | l5-code-05 | Review is one scroll of every changed file with no file list and no previous/next file buttons; Viewed folds a file. | Keep the file list beside the stack. |
| U5 | l5-code-02 | Doing it by hand sits under a folded "By hand"; Stage, Unstage and Discard are in each file's menu; no Stage all or Discard all; Commit with nothing staged commits everything. | Keep Stage all; refuse a commit with nothing staged. |
| U6 | l5-code-11 | Every file opens beside the chat as a tab of the side column, with the Files tree at its left; a single click reuses one preview tab until it is kept (Claude Desktop's shape); ⌘-click opens in the main area. | No preview tab: every click adds a tab. |
| U8 | O-36 | A click on the title-bar icon of the tool in view hides the side column and closes nothing (today it removes that tool from view); a tab stays until you close it. Each terminal is a tab of the column; the browser keeps its own page tabs inside it. At the first start after the change, a tool's tab that was not in view is dropped from the strip. A second group is made by a tab's menu or a drag, two groups at most, one above the other. | The icon closes that tool's tab; terminals keep a strip of their own; a free arrangement of groups. |
| U1 | l4-approvals-08 | Dismiss on a question the engine asked sends the decline that Esc sends today (the agent is told the question was denied and goes on), and the row then reads "Dismissed"; on MAWS's own ask it submits every question as skipped. No key of its own. | A sentence of MAWS's own to the agent ("dismissed, no answer will come") for every kind of question. |
| U2 | O-30 | In the folded to-human view a running turn keeps its "Working for …" line in view until it ends, although a finished turn's line shows only with one of its records open; a finished turn's menu (Restore files, Review changes) is then reached by opening a record or in the full transcript. | No turn line at all while folded, a running turn's included. |
| U6 | l7-shell-08 | Zoom is the whole window between 50% and 200%, with no control and no text-size setting. "Open in" remembers no editor. | A text-size setting. |
| U7 | O-16 | Hide is one item in the row's three-dot menu with no confirmation; no button on the row. The hidden set is kept per device. A hidden session returns by itself when it starts a turn. | A hide button on the row; a set that follows you to other Macs. |
| U7 | O-40 | An open page (Customize, Projects, the Library) hides the tab strip and shows Back and its name; Projects becomes a page too; Diagnostics and a Channel stay tabs. | The strip stays visible above the page. |
| U7 | O-40 | Settings left open when MAWS quits is not open at the next start, although the Settings tab was: a relaunch shows what was behind the dialog. The dialog has the size of MAWS's library dialogs (960 by 800 px at most) and closes at Close, Esc, ⌘W or a click on the dimmed window; going to a tab or a page closes it. | Reopen the dialog at a relaunch. |
| U7 | O-47 | The usage ring in the title bar shows no number; its popover lists every account's bars; the full panel is in Settings. | A percentage beside the ring. |
| U8 | O-09 | Finished work leaves its card at once and shows no outcome there, even a failure; the panel lists it under Done with failures counted. Scheduled jobs do not hold the card. No Stop on a card's row. | A failed task stays on the card until seen. |
| U8 | l5-code-14 | Review, Source control, Files and new terminals follow the agent into a worktree of the same repository, also after a cd if the engine records it; another repository is not followed. You asked for the live display only. | Display only; or follow any folder. |
| U9 | O-48 | Fork over the link is for the machine's owners only in this wave; a fork whose source runs above the machine's permission ceiling is refused, not lowered; no fork while the source's turn runs. "Archive sessions" on a project stays this Mac's. | Lower the mode instead of refusing. |
| U10 | l6-artifacts-15 | The agent may delete only an artifact its own session line created and no person wrote to, with an Undo in the transcript row. | Any artifact of the Space, with a confirmation. |
| U10 | l8-settings-13 | A Space's instructions reach the agent two ways: as a chip in the draft of a chat started from the Space, which you see and can delete, and in the artifact tools' answers for a session started anywhere else (again after a compaction). Claude Desktop instead adds them, unseen, to the system prompt of every session that belongs to the Space. | As Claude Desktop: a chat started from a Space carries them in its system prompt, with no chip; the session then has to remember its Space. |
| U10 | O-43 | The chat over an artifact has three states: card, bar and hidden; "Show chat" brings back the bar; a request that arrives while the chat is hidden leaves it hidden and marks "Show chat" (Claude Desktop shows a toast and leaves it hidden); with the bar showing it opens the card. | Two states. |
| U11 | l8-settings-06 | Settings is regrouped into App, Sessions and engine, and Org, opening at Appearance; each row's note is one line with the rest behind More. | Keep today's order and add search only. |
| U12 | l9-browser-delivery-06 | Device sizes are Mobile 375×812 and Tablet 768×1024 only, drawn at true size; the screenshot goes to the clipboard (Claude Desktop saves a file). | Save a file; more sizes. |
| U12 | l9-browser-delivery-07 | While an agent uses computer use, a strip at the top of the session's pane reads "Computer use running · Stop"; Stop interrupts the turn. | A mark on the tool row only. |
| U13 | O-01 | New chat closes every other empty unstarted chat in the strip. At the upgrade every per-project set is merged into one strip (on the MacBook 14 sets and 28 tabs arrive together), with a one-time notice and "Close tabs to the right". | New chat focuses the existing empty chat; the upgrade keeps only the set that was showing. |
| U13 | O-31 | The title bar's chip names the current project; a click shows that project's row in the sidebar. A tab names its project only in a mixed strip. | The chip does nothing; or goes away. |

## U1 · Requests

| id | from | state | the line |
|---|---|---|---|
| l2-transcript-10 | mark | build | The jump-to-latest button says when a request is waiting, as you accepted. |
| l4-approvals-08 | mark | build | You confirmed on 11-12: a question is drawn in the transcript in the row of the call that asked, a permission prompt at the transcript's end, and the composer stays free; a card in the right-hand column lists what waits in the session (your addition), present only while something waits. A message you send while a question waits is delivered as a message and the question keeps waiting; every question's form gets a Dismiss button for when the message settled it (your answers of 11-12). For a terminal session's question that does not block, Dismiss needs a small change in the sminos plugin first and is drawn disabled until then. |
| O-17 | observation | build | The notice above the composer goes. You answered on 11-12: the jump-to-latest button says when a request waits, and (your addition) the right-hand column gets a queue of pending questions, present only while something waits; choosing one brings it into view. |
| l4-approvals-07 | mark | build | The composer notice for a pending question is dropped; the request is announced once. |
| #358 | ticket | build | One cause with S-04, S-07 and X-066: an answered request counted as waiting until its tool sent a first frame. Only an unanswered request docks or counts. |
| S-04 | sitting | build | The same cause as #358: after you allow a long command, its row, tab, Needs you and the badge no longer read "Needs approval". |
| S-07 | sitting | build | The same cause as #358: the answered card leaves the composer at the answer. |
| O-22 | observation | build | An async question from a terminal session no longer takes the composer. It is answered in its own row in the transcript, from Needs you, the hover card or the Overview, and can be dismissed once the sminos plugin carries a dismissal (l4-approvals-08). |
| O-21 | observation | build | An answer to an async question fills the question's own row, on every route; the row no longer reads "Not answered" forever. |
| l4-approvals-02 | mark | build | The permission card becomes three buttons with key hints (Deny, Allow once, Always allow), about half its height; "Composer paused" and "Main session wants to" go. |
| l4-approvals-04 | mark | build | A call that waits for approval reads "Waiting for approval", not "Running" or "Edited". |
| O-23 | observation | build | Double-click picks and submits on a single-choice question and on Allow once. Not on multi-select or "Other". Claude Desktop has no double-click: by default its question card answers at one click on an option, and in its layout behind a server switch it preselects the first option. Your double-click is kept, because a single click that submits is easy to make by accident. |
| l4-approvals-05 | mark | build | A file-change approval shows a real diff, says "create" for a new file, and shortens paths. |
| l4-approvals-11 | mark | build | The plan approval button names the mode that follows, with a menu. Editing the plan is left out. |
| l4-approvals-13 | mark | build | The trust card lists only what would really load. |
| l4-approvals-12 | mark | build | Yes, it works, as "Approve and retry": probed on 11-12, the button's message got the blocked command to run 5 times out of 5. It is not what I first told you: nothing MAWS can do grants one exact call in auto mode. The button sends the engine's own consent sentence as a message, and the classifier treats your go-ahead after a block as consent. A command blocked by a rule that always denies is blocked again every time (0 of 3), and the engine does not say which kind of rule blocked a call, so the button stays and a repeated block says so. After two blocks in a row the engine asks you with an ordinary prompt instead. |
| l4-approvals-09 | mark | build | From a notification you can allow a shell command (shown in full) or a read-only tool, and deny anything. An edit opens the app. |
| #333 | ticket | build | The same rule on the sidebar hover card. |
| O-19 | observation | question to the owner | Larger than it reads: the sminos ask cannot serve a session MAWS runs today, for three separate reasons, and MAWS has no path to deliver its async answer. Two repositories. |
| #420 | ticket | question to the owner | Part of O-19. Its second half is a separate small choice (defer the edit tools again). |
| #421 | ticket | later | Follows O-19's answer. |
| l4-approvals-01 | mark | already built | Fixed: the agent's ask tool is pre-allowed. |
| l4-approvals-03 | mark | keep | Kept. |
| l4-approvals-06 | mark | keep | Kept: the Question sheet. |
| l4-approvals-10 | mark | keep | Kept: answering in place from the Overview. |
| l4-approvals-14 | mark | keep | Kept. |
| l2-transcript-16 | mark | same ask as another item | Part of the placement question (l4-approvals-08). |
| X-066 | tracker | same ask as another item | The same as #358. |

## U2 · Transcript structure

| id | from | state | the line |
|---|---|---|---|
| O-29 | observation | build | A run of tool calls collapses into one line worded as Claude Desktop words it ("Ran 3 commands, edited 2 files +12 −4, used 1 agent"), collapsed by default even while running, and opens to today's rows at full height (your answer of 11-12; Claude Desktop does not bound it either). MAWS had collapsed groups until the 10-23 fix flattened them. |
| O-27 | observation | build | You answered on 11-12: thinking is its own step, in order, inside the group. Your two conditions hold: thinking keeps the shape it has today and does not look like a tool row, and an opened group must not grow too long. In a session MAWS runs every thought has text (MAWS asks the engine for summaries), so only a thought of ten seconds or more gets a line in an opened group, which is the threshold you chose on 11-12 on the card "Thoughts 2". My first version tested for text and would have drawn every thought there; corrected on 11-12. |
| O-15 | observation | build | The closed turn's line carries a summary of the whole turn in Claude Desktop's words, at most three parts and "and N more actions", with what changed first (files, then agents). |
| #479 | ticket | build | Inside an opened group, a thinking block with no text gets a "Thought for Ns" line when it ran ten seconds or more, by the same test as a thought with text (O-27), and thoughts next to each other merge. Such blocks are now rare in a session MAWS runs (none among 85 thoughts since 10-31) and are the rule in terminal sessions (99%). The engine records every thought's duration in the session file since 2.1.287, which MAWS did not read, so the same line appears in a terminal session too: there about one thought in seven lasts ten seconds or more. |
| O-49 | observation | build | No path loses a description that a call carried. When a call has none, the row shows the command itself, or "Ran a command" when it is unsafe to show, as Claude Desktop does. Found on 11-12: in one session MAWS ran that day the agent gave no description on any of its 82 shell calls (its subagents did on all of theirs), which is probably what you saw. Checked the same day: the description is an optional field and the model left it out for that whole session; one terminal session of the last two weeks did the same (2 of 80 sessions), so it is not MAWS's doing and no setting of yours removed it. The fallback is the fix. |
| l6-artifacts-12 | mark | build | Artifact tool rows read by the artifact's title; a failed call shows the first line of its error. |
| O-13 | observation | build | You answered on 11-12: the mod draws first, and MAWS mirrors it. In sessions MAWS runs, the to-human mod draws its own view; in terminal and remote sessions, where no mod can draw, MAWS applies the mod's fold rule itself. The mod change you ruled on 10-24 is an unmerged branch: I rebase it onto 0.7.2, try it in one MAWS session and open the pull request, and you merge it. |
| O-30 | observation | build | Answered with O-13 on 11-12: the mod draws first and MAWS mirrors it. "Working record" folding is the mod's rule, applied by the mod where it runs and by MAWS elsewhere. In the folded view a turn's "Worked for …" line shows only while one of that turn's records is open (your answer of 11-12); a running turn keeps its line until it ends. |
| #332 | ticket | build | MAWS draws what the mod draws, orange included, as you ruled on 10-24. If orange reads as an error, that is settled in the mod; the ticket moves there. |
| l2-transcript-04 | mark | build | A turn a subagent's report opens no longer reads "Peer session worked for"; it reads "Continued for". A turn that another session's message really opened keeps "Peer session worked for", because that message folds with its turn and the line is what still says who woke the session. |
| #351 | ticket | later | Deferred on 11-12 after its probe: the engine recalls no memory on your configuration (automatic memory is off in your settings, and the engine's own switch for recall is off for your sessions), so a "Recalled 2 memories" step could never appear. The frame and its transcript row are recorded for a later build. The engine's permission-check and intent frames stay silent. |
| l2-transcript-01 | mark | already built | Built and still works. O-07 and O-08 are a different component, not regressions of it. |
| l2-transcript-03 | mark | already built | Built and still works: single line breaks are kept. Tracker row 367 closes with it. |
| l2-transcript-12 | mark | keep | Dismissed by you; nothing to do. |
| l2-transcript-14 | mark | keep | Kept: a subagent's started and finished rows stay as they are. Messages to and from it become one line (O-12). |
| O-26 | observation | same ask as another item | The first half of O-29. |
| O-25 | observation | same ask as another item | "Thought for 0s" is already fixed. The "Internal activity" wrapper goes with O-27. |
| l2-transcript-05 | mark | same ask as another item | The double fold is fixed; the summary text is O-15. |
| O-06 | observation | same ask as another item | Once the mod draws, its own toggle appears above the composer with no MAWS work. Follows O-13. |
| l2-transcript-06 | mark | same ask as another item | The same as O-13. |

## U3 · Transcript rows

| id | from | state | the line |
|---|---|---|---|
| O-12 | observation | build | A peer or subagent message is one line ("› Message from @name: …"), opened on demand, and folds with its turn. This is the CLI's form; Claude Desktop draws these as bordered cards, which is what you are asking to leave. |
| O-28 | observation | build | A background job's notification is drawn as one row where it reached the model, coloured by outcome, as the CLI does. Claude Desktop instead updates the task's own row. |
| O-34 | observation | build | A failed background task no longer raises an error card, a Needs you entry or a notification; its red line in the transcript says it (O-28). Dismiss looked dead because the session was on another machine, where dismissing is not carried yet (it will be). You answered on 11-12 that the line alone is enough, as in the terminal. |
| O-41 | observation | build | Two defects. A terminal session on this Mac draws a peer's delivery as your own message; and even the remote path draws it as a bubble labelled "From X" by an earlier decision. Every route will draw a peer row; your own sends stay your bubble. |
| X-032 | tracker | build | A steer of yours that went through the fallback route is drawn as yours, not as a peer's message. |
| O-07 | observation | build | Code blocks wrap long lines and have one frame with no empty header band, as Claude Desktop's do. |
| O-08 | observation | build | Code blocks and tables stay inside the text column; a wide table scrolls sideways. This reverses the 10-01 rule that let them break out. |
| O-02 | observation | build | Copy, Edit and the time sit below the message and show on hover. |
| l2-transcript-07 | mark | build | An answer gets Copy, Fork from here and its time. No Read aloud, no ratings. |
| O-18 | observation | build | A slash command's output is one dim line under the command, folded past two lines, as the CLI draws it. Newer engines send some outputs in a form MAWS reads as an answer; that is fixed with it. |
| #331 | ticket | build | While a session compacts, its working line says "Compacting session…". The engine host already knows; nothing reads it. |
| #146 | ticket | build | The web plugin's fetch is drawn like a web fetch. |
| l2-transcript-08 | mark | build | ⌘F finds in the session: messages, answers and tool labels, opening the fold that holds a match. |
| l2-transcript-09 | mark | build | A chord jumps between your prompts (⌥⌘↑, ⌥⌘↓), and with a message itself focused, up and down move between messages: both as Claude Desktop does, where its prompt keys are behind a server switch and its arrows move between messages only after a keyboard focus, which MAWS copies. No chapter rail: it would need a new agent tool and more on screen. |
| O-33 | observation | hands-on check (U14) | The table frame is O-07/O-08 and the "0s" line is O-35. The missing prompt bubble needs the same session opened on the mini to tell a lost delivery from a drawing fault. A live side-by-side with Claude Desktop is a step after this wave's transcript work. |
| #44 | ticket | already built | Its six items are covered elsewhere or fixed; the ticket closes. |
| l2-transcript-15 | mark | already built | Built: a stopped turn has its mark and no raw tag. |
| l2-transcript-02 | mark | already built | Built and still works. |
| l2-transcript-11 | mark | keep | Dismissed by you. Tracker row 42 closes with it. |
| l2-transcript-17 | mark | keep | Kept; nothing to do. |
| #330 | ticket | same ask as another item | The same as O-18. |

## U4 · Composer

| id | from | state | the line |
|---|---|---|---|
| X-049 | tracker | build | The queue row for such an answer reads "Answer to <question>: <choice>", not the raw envelope. |
| l3-input-01 | mark | build | Probed on 11-12: the engine no longer kills a running command when a message is sent "now"; it moves the command to the background, where it runs on. MAWS's Send now kills it today only because it sends a plain interrupt. One thing differs from what I first wrote: behind a command the engine ends the turn and answers your message in a new turn that starts at once (the cut turn reads "Ended for your message"); only behind a subagent call is the message read in the same turn. A Stop afterwards leaves the moved command running; it is in the Background tasks card. The accepted proposal also moved a command to the background by itself when your message had waited a few seconds behind it; you answered on 11-12 that a command moves only on Send now, so that part is not built. |
| l3-input-02 | mark | build | Stop keeps pausing the queue; Send now no longer does. |
| l3-input-03 | mark | build | ⌘Enter queues a message for after the turn. This reverses the 10-01 rule "no hold, no send menu". |
| l3-input-04 | mark | build | Up-arrow in an empty box takes back a waiting message for editing. |
| l3-input-05 | mark | build | Waiting messages live only in the stack above the composer; the transcript shows a message once it is delivered. This drops the dimmed tail bubbles of the 10-01 ruling. |
| l3-input-15 | mark | build | Send is an up-arrow in a filled circle, stop a square, and a distinct mark while a turn runs and the box has text, as you described. |
| l3-input-08 | mark | build | Enter always sends; Shift+Enter and Option+Enter break the line. |
| l3-input-06 | mark | build | The slash palette lists names only, one list in the engine's order, an icon per kind; the description shows for the highlighted row (hover or arrow keys, as Claude Desktop). MAWS's window actions leave it for ⌘K. |
| l3-input-07 | mark | build | Same-named projects show their path suffix beside the name in the New chat chooser. |
| l3-input-09 | mark | build | A paste stays as text, as in Claude Desktop. Only a very large paste (over 20,000 characters) becomes a chip, with "Show in text field". |
| l3-input-10 | mark | build | The mode menu reads Auto, Manual, Accept edits, Plan, then Bypass apart. |
| l3-input-12 | mark | build | Claude Desktop's chords: ⇧⌘I model, ⇧⌘E effort, ⇧⌘M mode, Ctrl+R history search. |
| l3-input-14 | mark | build | The model chip shows the model's display name everywhere. |
| O-32 | observation | build | The lightning is the fast-mode switch, not decoration; it becomes a "Fast mode" row. Each effort stop gets a full-height hit area and the track snaps to the nearest stop. |
| O-20 | observation | build | /btw shows an elapsed timer (the engine streams nothing for a side question, so it cannot show real thinking) and moves from the side tab to a small card at the bottom right of the session. |
| l2-transcript-13 | mark | question to the owner | You dismissed this but marked the same feature "fix" twice (l3-input-11, l6-artifacts-11). One answer for all three. |
| l3-input-11 | mark | question to the owner | The same feature as l2-transcript-13 (dismissed) and l6-artifacts-11 (fix). One answer for all three. |
| l6-artifacts-11 | mark | question to the owner | The same feature as l2-transcript-13 and l3-input-11. One answer for all three. |
| l3-input-13 | mark | keep | Kept. |
| X-050 | tracker | same ask as another item | Part of l3-input-05: two-line rows with the whole text on hover. |

## U5 · Review, comments and source control

| id | from | state | the line |
|---|---|---|---|
| O-45 | observation | build | Side thread is already the default. The two-way control becomes a "Send to main" checkbox, unchecked each time. (In Claude Desktop an unchecked comment reaches no agent; in MAWS it opens the side thread, as you said.) |
| l6-artifacts-05 | mark | build | Send to main confirms with a short note naming the session; the comment count ignores drafts. |
| l6-artifacts-19 | mark | build | After the agent answers a comment, only the commented passage is highlighted once, and the card folds to its pin in a narrow window. |
| l6-artifacts-20 | mark | build | The agent's reply to a comment is its own words, not tool output. The export dialog opens in the last export folder. |
| l5-code-01 | mark | build | Review gets line comments through the same comment card, opened with "Send to main" ticked; comments made in one pass are sent together. Checked on 11-12 in the app's own browser engine: the diff library closes an open card whenever the diff is re-read, so while you write a comment the diff of that file holds still and its header says "This file changed · Refresh". |
| l9-browser-delivery-05 | mark | build | Several comments on a page are collected into one message, as Claude Desktop does, designed once for the shared card. |
| X-216 | tracker | build | The page stops auto-scrolling after the comment card closes. |
| X-218 | tracker | build | The browser's comment card keeps its draft like the others. |
| l5-code-05 | mark | build | Review becomes one stacked list of files with sticky headers, as Claude Desktop's. Large; it is the anchor of the Review work. |
| l5-code-03 | mark | build | "This branch" compares against the default branch for every session, the main checkout included, and counts uncommitted and new files. |
| l5-code-04 | mark | build | New files already draw as added. Their line counts and their place in "This branch" are added. |
| l5-code-12 | mark | build | Wording and layout slips in Review and the push row. |
| X-072 | tracker | build | Review returns to the same file and place after a resize or late highlighting. |
| l5-code-02 | mark | build | Commit, Push and Create PR each send the agent a short instruction, as your note says agents do the commits. The row of three is MAWS's own: Claude Desktop has one button, which asks the agent to commit only where the folder has no GitHub repository and otherwise to create the pull request, committing and pushing inside that prompt. The forms stay as the manual route, trimmed. No generated-message dialog. |
| l5-code-06 | mark | build | No hunk staging (Claude Desktop has none). Review gains file-level Stage and Discard and Source control's own list goes. |
| O-46 | observation | build, after a check (U14) | Likely cause: a comment on an HTML page goes to the session that made the page, not the one on screen, and the card never says so. It will go to the session on screen, as documents and decks do, and "Send to main" confirms with a short note. Needs one reproduction on your build. |
| l5-code-15 | mark | keep | Kept: mechanical Undo and the hunk counter. |
| X-105 | tracker | same ask as another item | The same change as l6-artifacts-20. |

## U6 · Files, links and the keyboard

| id | from | state | the line |
|---|---|---|---|
| l5-code-11 | mark | build | A file opens in the side panel as a tab inside Files, chat untouched; drag, a menu item or a button moves it to the main area (MAWS already has that drag for artifacts). Claude Desktop enlarges with Fill or a new window instead. |
| l5-code-09 | mark | build | Files gets a Changed group on top, status colours and dimmed ignored files, then ⌘P quick open. |
| l5-code-10 | mark | build | "Open in" for VS Code, Cursor, Zed, Xcode, Terminal and Finder, where installed. |
| l9-browser-delivery-08 | mark | build | The same "Open in" on a session's menu and its sidebar row. |
| O-37 | observation | build | The choice does not exist: the engine's SendUserFile is already retired and MAWS's own send-file tool delivers. Fixed: the refusal reads as a permissions problem when it is not; a link to a PDF, HTML or media file opens outside the app; file:// links and relative paths are not clickable. One correction to what I told you: a link to a file outside the session's own folders is refused on this Mac too, not only on another machine. Whether such a link should open read-only is a question for you when this part starts; until then the notice says plainly why it did not open. |
| l9-browser-delivery-03 | mark | build | A local session's localhost links open in the in-app browser, as a remote session's already do; ⌘-click sends one to the system browser. |
| l5-code-08 | mark | build | Chords for the surfaces (⌘J Terminal, ⌘⇧D Review, ⌘⇧F Files, as in Claude Desktop) and "Attach selection to chat". No bottom drawer. Letting the agent read your terminal is left out. |
| l7-shell-06 | mark | build | ⌘K opens on your recent sessions and artifacts and can find artifacts. |
| l7-shell-07 | mark | build | A shortcut sheet, and a View menu in groups. |
| l7-shell-08 | mark | build | Zoom in and out; Actual Size has no chord because ⌘0 is the Overview. |
| l7-shell-09 | mark | build | Back and Forward across tabs, by chord and the Go menu. |
| l7-shell-13 | mark | build | A key jumps between regions; ⇧Tab's mode change is announced. |
| O-44 | observation | question to the owner | The inline link exists already, drawn as a boxed chip that does not read as a link; it will look like a link. The agent's ability to open artifacts by itself is removed. One thing is unclear. |
| l6-artifacts-01 | mark | question to the owner | You left this one unmarked. Claude Desktop previews DOCX and PPTX through its cloud; only PDF is a clear step for MAWS. |
| l5-code-07 | mark | hands-on check (U14) | Cannot be confirmed from code: MAWS adds no handling of its own, and your own typing was recorded as correct on 10-12. The corruption was only seen with cua's synthetic typing. Fixed only on a failing trace; the check is written out. |
| l5-code-13 | mark | already built | Settled by the 10-24 layout. One small piece remains and rides with l5-code-11. |

## U7 · Sidebar, title bar and destinations

| id | from | state | the line |
|---|---|---|---|
| O-16 | observation | build | Hide is built as its own thing, not as archive (archive stops a process and cannot reach a session a terminal holds). Hide is one item in the row's three-dot menu, with no confirmation and nothing stopped; hidden sessions sit behind "Hidden · N" at the end of the project; Unhide brings one back, and a hidden session comes back by itself when it starts a new turn. |
| O-38 | observation | build | Local rows already have "Open in new tab". Rows of sessions on other machines do not; they get it. |
| #559 | ticket | build | The same change as O-38: a remote row also honours ⌘-click and middle-click. |
| #407 | ticket | build | While the machine daemon restarts, the sidebar shows what it has with a "reconnecting" mark instead of ending the skeleton early. |
| S-11 | sitting | build | A new session is titled by the first six words of its prompt (60 characters at most) until a title is generated. The whole prompt stays searchable. |
| O-03 | observation | build | One regression from 10-24: the project chip's box is 96 px wide but its text may grow to 192 px, so a long name runs under the first tab. |
| O-40 | observation | build | You answered "a page, like Desktop" on 11-12, on a card of mine that was wrong about Claude Desktop, and then, on the corrected card the same day, "As Desktop really does". Settings opens as a dialog over the window (over your tabs, or over the Customize page when that is showing). Customize, Projects and the Library open as pages that replace the main area with the sidebar kept. None of them is a tab. |
| O-47 | observation | build | Usage becomes a small ring in the title bar that opens a compact one-column popover; the full multi-account grid moves to a Settings › Usage section. The sidebar footer keeps only the gear. |
| S-03 | sitting | hands-on check (U14) | The mini's own window showed none of one project's sessions. The cause is not found; it has to be diagnosed on the mini, and the fix goes on top of the registry branch. |
| S-08 | sitting | hands-on check (U14) | Chromium slows a hidden window; it matters to agents driving MAWS more than to a person. One timed check first, then throttling goes off only while something drives the app, as Claude Desktop does. |
| l7-shell-10 | mark | later | Not chosen: your answers on O-40 keep Settings and the pages inside the one window, so pop-out windows are not built in this wave. |
| l1-sessions-01 | mark | already built | Built on 10-24 and still works. One gap is left: a turn that finishes on another machine raises no notification. |
| l1-sessions-03 | mark | already built | Built: search reads what was said, on this Mac and on other machines. |
| l1-sessions-04 | mark | already built | Built: the search shows its count and is no longer capped silently. |
| l1-sessions-05 | mark | already built | Built: Needs you is kept and smaller. |
| l1-sessions-07 | mark | already built | Built: keys step through sessions. |
| l1-sessions-08 | mark | already built | Built: Reply and Allow once on the notification. Never tried on a signed build; that needs one hands-on check. |
| l1-sessions-09 | mark | already built | Built; the registry branch extends it (projects declared on any Mac list on every Mac). |
| l1-sessions-10 | mark | already built | Built: compact row, worktree mark left, status right, the three dots on hover. |
| l1-sessions-12 | mark | already built | Built: New chat from the title bar keeps focus. |
| l1-sessions-13 | mark | already built | Built: bulk archive and the opt-in automatic archive. Tracker row 321 closes with it. |
| l7-shell-01 | mark | already built | Built on 10-24: no empty panel column beside a non-session tab. |
| l7-shell-02 | mark | already built | Built on 10-24: the deck stage is no longer crowded out. |
| l7-shell-03 | mark | already built | Built on 10-24: side surfaces are title-bar icons. |
| l7-shell-05 | mark | already built | Built on 10-24: one chrome row; tabs no longer repeat the project name. |
| l7-shell-11 | mark | already built | Built on 10-24: the wordmark and "Local workspace" are gone. |
| l1-sessions-02 | mark | keep | Dismissed by you; nothing to do. |
| l1-sessions-06 | mark | keep | Dismissed by you; nothing to do. |
| l1-sessions-11 | mark | keep | Dismissed by you; nothing to do. |
| O-11 | observation | same ask as another item | The first image is O-03. The second (a transcript that could not load) is O-11b. |
| #521 | ticket | not MAWS's to fix | The project registry: the P5 session lands it. The sidebar items here build on it. |

## U8 · Card column, background work and the working folder

| id | from | state | the line |
|---|---|---|---|
| O-05 | observation | build | You answered on 11-12: two cards, Subagents and Background tasks, each present only while it has something running. Your addition: Subagents is a tree, listing the first level by default, and a nested agent opens when its parent is clicked. Artifacts leaves the cards for the title bar's three-dot menu, Connectors stays, and Environment opens by default. |
| O-09 | observation | build | The list reads "Running N" with every running kind together, then one folded "Done N" with counts by kind. Narrow tools remember their own width (about 360 px) apart from wide ones; today one shared width makes them open as wide as the browser. |
| O-10 | observation | build | The Context card drops its compaction, subagent and background rows. |
| #359 | ticket | build | Mostly built already: an ended agent reads finished, finished with errors, stopped or ended with the session, and one with a request of its own reads "Approval needed". What remains: an agent with work still running under it says how much; Done counts the failed and the stopped; a terminal session's agents stop reading "Working" once its process is gone (tracker row X-168). |
| X-165 | tracker | build | A panel width saved as exactly 380 px is no longer read as "automatic". |
| X-168 | tracker | build | A terminal session's background agent stops reading "working" once its terminal has ended. |
| l5-code-14 | mark | build | Larger than the display you asked for: once the agent moves into a worktree, Review, Source control, Files and the Environment card all keep reading the launch folder. They will follow the agent into a worktree of the same repository (Claude Desktop follows its own worktree tool; MAWS also follows a cd into a worktree, if the engine records it), and the card shows the live folder and branch. Another repository is not followed. A probe of the engine's record comes first. |
| l5-code-16 | mark | build | The Environment card's change line already opens Review; it is drawn as a control so that this shows. The second Review button and the Claude Code version row leave the card (the version stays in Session info). |
| O-36 | observation | build, after an answer | You answered on 11-12: tabs beside the chat, one tool in view, and you added that stacking should stay possible when you want it. So the tools beside the chat are tabs of one strip (Review, each terminal, the browser, each open file, the panels), nothing is placed under another by itself, and you can move a tab into a second group under the first. A click on the icon of the tool in view hides the column and closes nothing. It reverses your 10-24 ruling. One card asks how far "stacked, and so on" goes: two groups as written, a free arrangement, or tabs alone. |
| l7-shell-04 | mark | same ask as another item | Your words on this mark are O-05. |
| l6-artifacts-06 | mark | same ask as another item | Overtaken by your later O-44 (no automatic opening) and O-05 (card order). |
| #566 | ticket | not MAWS's to fix | What the window draws while sessions work unattended: context for the cards work, not a change of its own. |

## U9 · Sessions on other machines

| id | from | state | the line |
|---|---|---|---|
| O-11b | observation | build | A transcript whose read failed because the engine host was restarting retries by itself once the host is ready, and says "Couldn't load this conversation · Retry" only if that fails. |
| O-39 | observation | build | Your screenshot is New chat's project chooser, which waits for two reads together and keeps nothing between opens. Three visible faults are fixed now: the chooser shows projects as soon as they answer; a remote tab says "Connecting to <machine>…" instead of "offline" while its link comes up (you chose the three states on 11-12); a loading pane says so. How long the real wait is has never been measured on real machines; that needs a sitting. |
| #563 | ticket | build | A remote tab stays mounted and readable under a thin "Reconnecting…" line, so the reader keeps their place. |
| #565 | ticket | build | No whole-history read beside a live resume when a link returns; a failed hold heals by itself. |
| S-05 | sitting | build | A remote row with its tab open reads the tab's live stream, so it shows Working at once instead of 5 to 10 s late. |
| O-48 | observation | build | Fork, Archive and Rename were left off the link to other machines on purpose in P5. They are added together, with Unarchive; Fork is for the machine's owners in this wave, needs no Touch ID on a machine you own, and also becomes a /fork item and "Fork from here" on an answer, for local sessions too. Stopping a turn already works there; ending a remote session's process without archiving is not added. |
| S-02 | sitting | build | Archive and Rename for a session on another machine, in the same change as O-48. |
| S-01 | sitting | build | A Stop that fails says so, and reads "Stopping…" while it is on its way. |
| S-13 | sitting | build | The Touch ID sheet names the machine by its name. |
| O-35 | observation | build, after a check (U14) | When the remote machine reports no running turn, MAWS draws every open turn as finished, so a turn opened by a notification reads "Continued for 0s". A turn will be drawn finished only when the machine says the process is gone. Which signal reads wrong while the agent works needs one check. |
| #429 | ticket | hands-on check (U14) | Narrow: a reload loses the draft only for a New chat with attachments, between the spawn and the remote session being ready. Built only if a check shows the gap lasts more than a few seconds. |
| #526 | ticket | later | A reader's grade before the first send: your org has one member, so nothing is shared below Converse yet. |
| X-237 | tracker | later | Rides with #526. |
| #352 | ticket | closes, nothing to build | Its premise does not hold (local panes draw no pause rows). Replaced by the reconnect line of #563; the ticket closes. |
| S-06 | sitting | not MAWS's to fix | MAWS's row drew the question within 1 to 2.6 s; only sminos's own listing lagged. Yours to rule at the P5 verdict. |
| S-12 | sitting | not MAWS's to fix | Most likely the engine's own exit code; dropped. |

## U10 · Artifacts

| id | from | state | the line |
|---|---|---|---|
| l6-artifacts-07 | mark | build | A format cleanup is never a write of its own. Checked on 11-12 with a failing test through the real document service: the cause is the one inferred, and the refused edit is one that leaves part of a bold run without its bold. The fix is to switch the library's clean-up off on every document; the narrower fix I had first described misses three paths (restore, accepting and rejecting a suggestion). Page size and density are document settings the agent can set. The agent may delete its own drafts, with Undo. |
| X-141 | tracker | build | A presence redraw no longer writes a phantom revision. |
| O-43 | observation | build | The compact composer becomes the bar alone, and can be closed; a "Show chat" control in the artifact's header brings it back: the place and the word of Claude Desktop's hosted-artifact frame, where the labelled button is behind server switches. A request that arrives while the chat is hidden leaves it hidden and marks "Show chat". |
| l6-artifacts-08 | mark | build | "Make something new" keeps four kinds as cards and the rest under More, with a small design-system picker. |
| l6-artifacts-15 | mark | build | Design-system components are drawn on a smaller canvas so they read at size. |
| l6-artifacts-18 | mark | build | Create already takes a file path; publish gains one. Interactive dashboards are routed to HTML. |
| l8-settings-13 | mark | build | A Space can carry instructions for the agent. |
| l6-artifacts-09 | mark | build, after a check (U14) | Your P1. Probably one mechanism with l6-artifacts-07: a formatting cleanup written with no author, which the live document rejects and replicas echo back as writes nobody made. The work starts from a failing test. |
| l6-artifacts-16 | mark | build, last | Check against the design law resolves real colours and shows the agent's verdict per rule. Large; scheduled last. |
| l6-artifacts-14 | mark | question to the owner | Never reproduced. One fact only you hold decides it. |
| l6-artifacts-17 | mark | already built | Nothing left beyond l6-artifacts-07. |
| l6-artifacts-04 | mark | already built | Fixed on 10-24; one hands-on look at the 1280 px layout is owed. |
| l6-artifacts-02 | mark | keep | Kept. |
| l6-artifacts-03 | mark | keep | Kept. |
| l6-artifacts-10 | mark | keep | Kept. |

## U11 · Settings, connectors and the Org pages

| id | from | state | the line |
|---|---|---|---|
| l8-settings-01 | mark | build | Sign in exists, but not for plugin-provided servers or the servers added in MAWS's own Settings. Both get it. |
| l8-settings-03 | mark | build | The libraries work before the first message. |
| l8-settings-04 | mark | build | The MCP widget's rows are compact and called Connectors; its switch means "off in this chat". |
| l8-settings-06 | mark | build | Settings is regrouped and its long notes shortened, then gets a search. |
| #540 | ticket | build | Each refusal on the Org sheets names the next step. |
| #523 | ticket | build | Share sheet: one scrim for every sheet, a plain remedy line, the full machine name on hover. |
| #505 | ticket | build | Channel tab: a stable scrollbar gutter and sensible truncation of names. |
| #456 | ticket | build | The LiveQuery sheet gets its missing line for a paused query. |
| S-09 | sitting | build | The Channel tab says it is offline and retrying as soon as its read fails. |
| S-10 | sitting | build | The Channel opens from the command palette (one entry per project that has one, with its waiting count) and from the View menu. No new button; the project row already shows its waiting count. |
| X-184 | tracker | build, after an answer | Plugin-provided connectors appear under My items, with Sign in. |
| l8-settings-05 | mark | build, after an answer | "Add custom connector…" moves to Customize and writes the Claude Code config with a scope. |
| l8-settings-07 | mark | build, after an answer | A skill can be switched off (the engine now supports it), revealed in Finder and opened. "New skill…" starts a chat with the skill creator. |
| #455 | ticket | question to the owner | A security call: reading another machine's connectors asks for Touch ID each time the sheet opens. |
| l8-settings-11 | mark | question to the owner | Option B rested on a misreading of Claude Desktop: its "make default" stores an app preference and writes no Claude Code settings file. |
| O-14 | observation | question to the owner | MAWS has the kind on the outside (Plugins, Skills, Connectors, each with My items and Discover), and so does Claude Desktop 5. Your sentences ask for both orders. Missing icons are a recorded privacy ruling, not a bug. |
| #476 | ticket | hands-on check (U14) | The ticket names switches that do not exist in MAWS, and no engine setting is yet shown to drop a server's tools at launch. A probe first, then its own design. |
| l8-settings-12 | mark | later | A project settings page: after the registry lands, because a project then has locations on several machines. |
| l8-settings-02 | mark | already built | Built: Customize is the home for plugins, skills and connectors. |
| l8-settings-08 | mark | keep | Kept. |
| l8-settings-09 | mark | keep | Kept. |
| l8-settings-10 | mark | keep | Kept. |

## U12 · In-app browser, computer use and delivery

| id | from | state | the line |
|---|---|---|---|
| l9-browser-delivery-01 | mark | build | Mostly answered in code already: when cua acts on an in-app tab, the Browser pane opens. What is left is wording: cua tells the agent about the in-app browser only in a place it does not read. I could not find the ticket you mention, so I file one. MAWS adds one sentence to its instructions. |
| l9-browser-delivery-02 | mark | build | The agent's show-pane call reloads the page unless you are using that tab. |
| l9-browser-delivery-06 | mark | build | Device sizes and a page screenshot. No site-permission prompt: nobody asked for one, and Claude Desktop's only such prompt is for local-network access. |
| #435 | ticket | build | A pane the agent opens from a remote session appears on the device that sent the turn. |
| l9-browser-delivery-07 | mark | build | MAWS shows "computer use running · Stop" while a cua call is in flight. The wire cannot say which app is driven; I file a cua ticket for that. The on-screen cursor gets the session's name. |
| l9-browser-delivery-09 | mark | build | Send to Drive converts a document to Google Docs and a deck to Google Slides by default (one field was missing), with "As a file" kept. Nothing converts to Sheets: MAWS has no spreadsheet export. |
| #400 | ticket | later | Drive through a connector instead of gws: its own design. Note that gws sign-in expires weekly while its Google client is in testing mode. |
| l9-browser-delivery-04 | mark | keep | Kept. |
| l9-browser-delivery-11 | mark | keep | Kept. |
| l9-browser-delivery-10 | mark | keep | Kept. |

## U13 · Tabs, New chat and session groups

| id | from | state | the line |
|---|---|---|---|
| O-01 | observation | build | You answered on 11-12: one strip for everything open, across projects and machines, restored after a relaunch, with no hidden per-project sets. So New chat no longer seems to replace your tabs (that was the strip switching to another project's set), and pressing it again reuses an empty unstarted chat instead of piling up another. This reverses the 10-01 ruling of a tab set per project. |
| O-31 | observation | build | The click that starts a session is the project chip in the title bar, not the sidebar row; the chip stops creating a session. With one strip (your 11-12 answer) a group is a named set of sessions that you open as tabs; groups get a design round with drawn examples before they are built. |
| #497 | ticket | build | A New chat tab that arrives late no longer takes the selection from a tab you opened meanwhile. |
| O-42 | observation | design round with the owner | A machine filter on the sidebar can come first, as you offered. Project / machine / group views follow the groups design. |
| O-24 | observation | design round with the owner | Depends on the groups design. Claude Desktop has no icon rail: folded, hovering shows the whole sidebar as a popup, which is the cheaper option. |
| l6-artifacts-13 | mark | hands-on check (U14) | Opening a file from the panel replaced the deck tab. MAWS has no preview tabs; the likely cause is the same tab-set switch as O-01. Needs a reproduction. |
| l7-shell-12 | mark | keep | Kept: the rebindable keymap and the relaunch that restores everything. A literal "stateless" reading of O-01 would remove the restore; the design question asks which you mean. |

## Handed to the visual renewal

| id | from | state | the line |
|---|---|---|---|
| O-04 | observation | visual renewal | Roundness of tabs and older components: handed to the visual renewal. The list of square components is in the grounding. |
| PR #144 | ticket | visual renewal | The thinking mark: visual work, and its base changed. Rebase after O-27 is built. |
| #342 | ticket | visual renewal | Row alignment on the Org People page: visual; handed to the renewal. |
