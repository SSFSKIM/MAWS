# Word cut: The conversation and the message box

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

172 items: 114 cut, 3 reworded, 55 stay. Of the 117 that change, the owner saw 24 in a picture or ruled on them; 93 follow the pattern and were not seen.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin.

## The conversation

### Session transcript, turn line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T1 | the grey line with a chevron above each turn's work, folding it; one of 9 verb forms (Working, Working for, Worked for, Continued for, Peer session worked for, You stopped after, Stopped after … (engine process exited), Ended for your message after, Failed after) | Worked for 2m 14s | reword | a finished turn's line reads the duration alone ("3s · Ran an agent"): "Worked for" is dropped, the time stays. The exception forms (Stopped, Failed, Ended for your message) keep their words | ruled | `src/renderer/src/transcript/model/copy.ts:57` |
| T2 | after the verb on a finished turn's line: what the turn did, the first three parts and the rest counted | Edited 3 files, ran 2 commands, searched code, and 4 more actions | reword | A capped caption keeps its first two parts, then names every skill or connector the folded parts used ("ran /dataviz", "used notion"), once each, then "+N" for the rest; no "+N" when nothing else is left out. | brought back | `src/renderer/src/transcript/model/caption.ts:58` |

### Session transcript, run of tool calls

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T11 | the run line while one of its calls waits for a permission, led by a half-disc glyph in the warning tone | Waiting for approval: `rm -rf build` | stays | Stays. kept: consent | not a cut | `src/renderer/src/transcript/model/copy.ts:210` |
| T13 | an edit call's line inside an opened run; also Created and Deleted | Edited src/app/main.ts +3 −1 | stays | Stays. brought back on shell-tools-open, shell-tools-transcript-view, shell-tools-transcript-view-end | brought back | `src/renderer/src/transcript/model/copy.ts:133` |
| T15 | a shell call the engine moved to the background, or one started there | Moved `pnpm dev` to the background after 12s | stays | Stays. the step keeps its fact (in the background) but loses "after 12s"; step durations were neither shown nor named \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:146` |
| T17 | an artifact screenshot call's line | Screenshot of Q3 plan v3 (1280 × 800) | cut | An artifact screenshot call reads "Screenshot of Q3 plan", with no version or pixel size. | pattern | `src/renderer/src/transcript/model/copy.ts:589` |

### Session transcript, an opened call

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T18 | opened shell call: three text buttons, one beside the command and two in the footer | Copy command · Copy output · Copy all | cut | An opened shell call has one copy glyph in its footer (copies everything); hovering the command or the output shows a copy glyph for just that part. | pattern | `src/renderer/src/transcript/view/cells/ShellDetail.tsx:47` |
| T19 | opened shell call, under a command longer than 8 lines | Show more command | cut | The toggle under a long command reads "Show more" / "Show less". | pattern | `src/renderer/src/transcript/view/cells/ShellDetail.tsx:50` |
| T20 | opened shell call, under the command, when the command ran in the session's own folder | Session directory ~/project | cut | An opened shell call no longer names the folder when the command ran in the session's own folder; a different cwd is still named. | pattern | `src/renderer/src/transcript/view/cells/ShellDetail.tsx:53` |
| T22 | opened shell call, footer, after a successful command | ✓ Exit code 0 · 3s | cut | A successful shell call's footer shows only its time ("3s"); a failed one keeps "✕ Exit code 1 · 3s". | pattern | `src/renderer/src/transcript/model/copy.ts:186` |
| T26 | opened call while its full result loads | Loading the full result… | cut | While a spilled result loads, a small spinning ring stands where the Load button was (the words are its accessible name and hover). | pattern | `src/renderer/src/transcript/model/copy.ts:379` |
| T28 | opened edit call: a + or − sign before every changed line | + / − | stays | Stays. diff + and − signs become colour bars; a glyph swap no picture showed, and colour alone carries the sign \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/view/cells/EditDetail.tsx:59` |
| T31 | opened MCP call: a heading repeating the server and tool the line above already names | github · create_issue | cut | An opened MCP call no longer repeats "github · create_issue" in its heading; only the Raw toggle sits there. | pattern | `src/renderer/src/transcript/view/cells/McpDetail.tsx:58` |
| T34 | last line of every opened call in a turn auto mode reviewed, when the call passed | Auto mode · reviewed · not flagged | stays | Stays. "reviewed · not flagged" is a passing verdict; the owner brought back passing statuses that assure (Connected, saved) but left lifecycle words cut \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:217` |

### Session transcript, thinking

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T36 | a line of its own for each thinking block of ten seconds or more, inside a run or beside it, opening to the thought's text; "Thought" when no time was recorded | Thought for 14s | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/transcript/model/copy.ts:192` |
| T37 | while a thinking block streams, shimmering and warming in colour after 10 s; tiers Thinking, Still thinking, Thinking more, Thinking some more, Deep in thought | Thinking some more with high effort · 34s | cut | A streaming thought reads "Thinking some more · 34s" with no effort words. | pattern | `src/renderer/src/transcript/model/copy.ts:200` |

### Session transcript, your message

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T41 | under a dimmed message sent while a turn runs; 2 forms (Sends at the next step, Sends when this turn ends) | Sends at the next step | stays | Stays. when a queued message will send moves to hover behind a dashed outline; the owner brought back the hint that teaches the two queues (C3) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:324` |
| T42 | under a message the engine took in the middle of a turn | Sent during this turn | cut | A message the engine took mid-turn has no "Sent during this turn" caption. | pattern | `src/renderer/src/transcript/model/copy.ts:325` |
| T45 | chip on a message sent from an artifact, naming the version that went with it | Q3 plan, read at revision 3 | cut | The chip on a message sent from an artifact reads "Q3 plan · rev 3". | pattern | `src/renderer/src/transcript/model/user-text.ts:116` |

### Session transcript, time separator

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T47 | centred between messages after an hour's gap before your message, or ten minutes before the engine's; 4 forms (Today, Yesterday, weekday, date) | Today 2:14 PM | stays | Stays. brought back on shell-tools | brought back | `src/renderer/src/transcript/model/time.ts:62` |

### Session transcript, boundary line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T48 | a ruled line where the context was compacted; also "Compacted earlier · 152k → 31k" for history | Context compacted · 152k → 31k tokens · auto | cut | A compaction line reads "Compacted · 152k → 31k", for live and earlier compactions alike. | seen | `src/renderer/src/transcript/model/copy.ts:281` |
| T49 | a ruled line where the conversation was reset; "· after plan approval" or "· cleared" follows | Conversation reset · after plan approval | cut | A reset line reads "Reset after plan approval", or "Cleared". | pattern | `src/renderer/src/transcript/model/copy.ts:284` |
| T50 | a ruled line where the session went on from an earlier message, with a second sentence under it | Conversation continued from an earlier point · Later messages from the previous path are no longer part of the current conversation history | cut | The branch line reads "Continued from an earlier point"; the sentence about later messages is its hover. | pattern | `src/renderer/src/transcript/model/copy.ts:293` |
| T52 | a ruled line where you rewound, with a Show or Hide button | Rewound to here · 3 messages hidden Show | cut | A rewind line reads "Rewound · 3 hidden Show". | pattern | `src/renderer/src/transcript/model/copy.ts:296` |

### Session transcript, error or notice line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T56 | the line left behind once a reconnect or a resume succeeded; 2 forms (Reconnected, Resumed) | Reconnected | cut | A session resumed after a release leaves no "Resumed" line (a reconnect already left none). | pattern | `src/renderer/src/transcript/model/copy.ts:303` |
| T57 | a notice where MAWS stopped an idle session's process; 2 forms | Released to stay under the memory budget · sending resumes it | cut | A released session's notice reads "Paused to save memory · send to resume" or "Paused while idle · send to resume". | pattern | `src/renderer/src/transcript/model/copy.ts:305` |
| T58 | while a paused session starts again | Resuming… | cut | While a released session starts again, no "Resuming…" line is drawn; the session's own running mark shows it. | pattern | `src/renderer/src/transcript/model/copy.ts:307` |
| T59 | a notice after an app update could not keep the running engine | The engine could not be re-attached after the update; the session was resumed. | cut | After an update that could not keep the engine, the notice reads "Resumed after the update". | pattern | `src/renderer/src/transcript/model/copy.ts:310` |
| T64 | a bordered bar where history is missing; 4 forms (not available, too large on a machine ×2, N items too large) | This session’s earlier history on studio is too large to show here yet; new messages appear below as the session goes on | cut | The missing-history bar's long form reads "Earlier history on studio is too large to show"; the other three forms are as before. | pattern | `src/renderer/src/transcript/model/gap.ts:18` |
| T65 | a note over a reply the interrupt cut off; a second sentence when only its end was kept | Cut off by the interrupt: the session didn’t keep it. Only its end was kept, so it starts partway through | cut | The note over a reply the interrupt cut reads "Cut off · not kept by the session", and "· starts partway" when only its end was kept. | pattern | `src/renderer/src/transcript/view/rows/AssistantText.tsx:26` |

### Session transcript, replayed command

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T66 | footer under the output of a ! command you ran yourself | exit 0 | cut | A ! command you ran shows no "exit 0" footer; a non-zero exit keeps it. | pattern | `src/renderer/src/transcript/model/copy.ts:326` |
| T67 | header over the text a slash command printed | Command output | cut | A slash command's printed output has no "Command output" header. | seen | `src/renderer/src/transcript/model/copy.ts:320` |

### Session transcript, notice line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T68 | a dot-led line where a scheduled task opened a turn | Running scheduled task · Check the nightly build | cut | A scheduled task's line reads "Scheduled · Check the nightly build". | pattern | `src/renderer/src/transcript/model/copy.ts:250` |
| T70 | a dot-led line where the bridge woke the session | sminos bridge woke the session to read a message it had not read | cut | The bridge's wake line reads "Woken to read a message". | pattern | `src/renderer/src/transcript/model/copy.ts:253` |
| T71 | at the end of a finished background task's notice | · 12s | stays | Stays. a finished background task's duration moves to hover; near the turn duration the owner brought back (T1); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/transcript/view/rows/Notice.tsx:26` |

### Session transcript, message between agents

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T73 | a ›-led line for each message to or from a subagent or another session; 3 lead-ins (Message from, Report from, Sent to) | Message from @reviewer: The migration is safe to run | cut | A message line leads with an arrow for its direction (← from, → to) and then the name and preview; "Report from" keeps its words and the › mark. | seen | `src/renderer/src/transcript/model/copy.ts:237` |
| T74 | at the end of a message this session sent to another; 4 states (Sending, Sent, Not sent, Never answered) | Sent | stays | Stays. "Sent" is a delivery assurance; the owner brought back Connected and asked for the saved status, but left lifecycle words cut; lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/transcript/model/copy.ts:491` |
| T75 | at the end of every message that came from another session | Reply | cut | Reply shows only on hover or focus of the line, as it already did. | pattern | `src/renderer/src/transcript/model/copy.ts:492` |
| T76 | the reply box after pressing Reply or Message: a label over the field | Reply via Fix flaky upload test | cut | The reply box has no label above it; its placeholder reads "Reply to reviewer, via Fix flaky upload test…" (the old label is the field's accessible name). | pattern | `src/renderer/src/transcript/model/copy.ts:494` |
| T79 | the reply box, a status line above the field after sending; 7 forms in 2 modes (Asked S to reply · 12s; … · S sends it at its next tool boundary or when this turn ends; … · S is inside a long tool call; it sends it when that call returns or this turn ends; S is replying with SendMessage; S replied with SendMessage; …, in its own words; Reply failed: …) | Asked Fix flaky upload test to reply · 48s · Fix flaky upload test is inside a long tool call; it sends it when that call returns or this turn ends | cut | The line over the reply box reads "Sending · 48s", then "Sent" or "Sent, reworded"; why it waits and how it was sent are its hover; failures keep "Reply failed: …". | pattern | `src/renderer/src/transcript/model/copy.ts:500` |

### Session transcript, agents listing

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T81 | a whole block wherever the agent listed its agents: a self line, up to three headed sections, a row per agent with its ref, extras and a Message button, then notes | This session is lead [a1b2] · Subagents · 3 · Teammates · 2 · Peer sessions · 4 · … | cut | An agent listing is one line, "Listed 9 agents", with a chevron; opening it shows the sections, rows and notes. | pattern | `src/renderer/src/transcript/view/rows/AgentList.tsx:36` |
| T82 | first line of the block | This session is lead [a1b2] | cut | The listing no longer has a "This session is lead [a1b2]" line. | pattern | `src/renderer/src/transcript/model/copy.ts:515` |
| T84 | at the end of every agent's row | Message | cut | Each agent row's Message button shows only on hover or focus of the row (and stays while its box is open). | pattern | `src/renderer/src/transcript/model/copy.ts:517` |
| T85 | in place of the block while the listing call is out; and when it never returned | Listing the agents and sessions… | cut | While the listing call is out it reads "Listing agents…"; the never-answered form is unchanged. | pattern | `src/renderer/src/transcript/model/copy.ts:513` |

### Session transcript, agents started

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T86 | a line with a glyph per agent wherever the session started or finished subagents; 4 endings (started working, finished, finished with errors, was stopped) | Explore, Plan and 2 more started working | cut | The subagent line shows the agents' glyphs and names with no verb, a spinning ring before them while they work; "· with errors" and "· stopped" keep their words. (Partly applied on the scratch branch: The existing glyphs serve as the per-agent chips; a per-agent state dot was not added, because the row carries only the group's status, not each agent's.) | seen | `src/renderer/src/transcript/model/copy.ts:225` |
| T87 | under that line while agents work: one line per agent | Explore · Grep · 1m 12s | cut | The per-agent "Explore · Grep · 1m 12s" lines under a working subagent row are gone; each agent's glyph (or a single agent's line) shows that text on hover. | seen | `src/renderer/src/transcript/model/copy.ts:232` |

### Session transcript, plan

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T88 | header of the bordered plan card | Plan | stays | Stays. the plan card loses its only name ("Plan"); the owner kept the request card's "◇ Plan"; the header may read empty \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:264` |
| T89 | badge right of the header while the plan waits | Pending | cut | A waiting plan shows the orange ◐ disc ("Pending" is its accessible name and hover) instead of the badge. | pattern | `src/renderer/src/transcript/model/copy.ts:262` |
| T90 | badge right of the header once decided; 3 forms (Implemented, Cleared context and implemented, Kept planning: feedback) | Cleared context and implemented | cut | A decided plan's badge reads "Approved", "Approved, context cleared" or "Kept planning: …". | pattern | `src/renderer/src/transcript/model/copy.ts:260` |

### Session transcript, questions card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T93 | top row of the card for questions the agent sent through MAWS (an icon, a title, a count, a state chip, a button): the title when the agent gave none | Questions | cut | A question capsule with no title of its own shows its count ("3 questions") as its heading. | seen | `src/renderer/src/transcript/model/copy.ts:418` |
| T94 | the count after the title | Asked 3 questions | cut | The count reads "3 questions". | seen | `src/renderer/src/transcript/model/copy.ts:419` |
| T95 | state chip while the card waits; 2 forms (Waiting for you, Asked, answer when ready) | Asked, answer when ready | stays | Stays. the orange disc for a blocking ask is the waiting mark's proper use, but a hollow disc for "not blocking" is a new mark no picture showed \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:420` |
| T96 | state chip once answered | Answered | stays | Stays. the questions card keeps its state mark: "Answered", "Partially answered", "Not answered" | ruled | `src/renderer/src/transcript/model/copy.ts:420` |
| T97 | state chip when the questions were withdrawn; 2 forms | Cancelled, the turn was interrupted | cut | A cancelled capsule's chip reads "Cancelled"; why is its hover. | pattern | `src/renderer/src/transcript/model/copy.ts:421` |
| T98 | the card's button; "View answers" once answered | View answers | cut | An answered capsule has no "View answers" button; its top row is itself the press that opens the answers. "Open" stays while it waits. | seen | `src/renderer/src/transcript/model/copy.ts:423` |

### Session transcript, delivered files

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T100 | heading of the block where the agent handed over files; one file is named, several are counted; 4 states (Delivered, Delivering, Could not deliver, … was never answered) | Delivered report.pdf | stays | Stays. the verb on an action line ("Delivered"), like "Edited" (T13); without it a lone filename reads bare | pattern | `src/renderer/src/transcript/model/copy.ts:454` |
| T101 | beside every delivered file: two text buttons | Open externally · Reveal in Finder | cut | Open externally and Reveal in Finder show only on hover or focus of the file's line; the name itself opens the file. | pattern | `src/renderer/src/transcript/model/copy.ts:458` |

### Session transcript, artifact line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T102 | a line with an artifact icon wherever the agent made or updated an artifact; 5 forms (Artifact T · v3, Updated artifact T · v4, Registering artifact T…, … was never answered, Could not register artifact T: …) | Updated artifact Q3 plan · v4 | stays | Stays. the verb on an action line ("Updated artifact"), like "Edited" the owner brought back (T13) | pattern | `src/renderer/src/transcript/model/copy.ts:528` |
| T103 | at the end of the artifact line | Open | cut | The artifact line has no Open button; its name is itself the press that opens the version. | seen | `src/renderer/src/transcript/model/copy.ts:533` |

### Session transcript, browser action

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T105 | after the phrase: how long it took and, sometimes, what it waited for | 1.2s · waited 3.0s for you | cut | A browser action's time and wait ("1.2s · waited 3.0s for you") show only on hover of its line. | seen | `src/renderer/src/transcript/view/rows/BrowserAction.tsx:33` |
| T106 | at the end of the line: up to three text buttons (Show snapshot or Show value, Open, Open tab) | Show snapshot · Open · Open tab | cut | Show snapshot, Open and Open tab show only on hover or focus of the line (and stay while the snapshot is open). | seen | `src/renderer/src/transcript/model/copy.ts:697` |
| T107 | under the line of an action the interrupt stopped | Cancelled, the turn was interrupted | cut | An action the interrupt stopped is noted "Cancelled". | pattern | `src/renderer/src/transcript/model/copy.ts:695` |

### Session transcript, side thread line

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T109 | a line with a thread icon wherever a side thread was opened from this session, with an Open button; 3 states (opened, finished · N turns: …, ended with an error) | Side thread on `main.ts:42` finished · 3 turns: Renamed the helper Open | stays | Stays. "Side thread on … finished · 3 turns" becomes an icon and the file; the kind word is cut like the "Edited" verb that came back (T13) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/view/rows/SideThread.tsx:24` |

### Session transcript, waiting request

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T110 | where a request card would stand, only if no card is registered to draw it | Waiting for you · Bash · answer in the composer | cut | Where no request card is registered, the slot shows the orange ◐ disc and the tool's name; the old sentence is its accessible name and hover. | pattern | `src/renderer/src/transcript/model/copy.ts:267` |

### Session transcript, loading and failure states

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T111 | centred in an empty transcript once its history has taken 300 ms | Loading… | cut | An empty transcript whose history is slow to load shows a quiet spinning ring, no "Loading…". | pattern | `src/renderer/src/transcript/model/copy.ts:388` |
| T114 | a bar across the top while a jump pages back to an old message, with Stop | Loading earlier messages to reach the message · 40% | cut | The bar for a jump to an old message reads "Finding the message · 40%". | pattern | `src/renderer/src/transcript/model/copy.ts:395` |

### Session transcript, the agent's prose

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T119 | inside a chip for an image the agent referred to by path | chart.png · /tmp/out/chart.png | stays | Stays. a path moves to hover; the owner left some where-from cuts (W4, T253) and brought back others (connector path G254) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/view/markdown/Link.tsx:78` |

### Transcript, where a request was raised (while its card stands below)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C85 | a bordered row in the transcript at the tool call that asked | Waiting for you · Bash · answer below ↓ | cut | The transcript's pointer row reads "◐ Bash ↓"; its accessible name keeps the full sentence. | pattern | `src/renderer/src/request-card/InlinePointer.tsx:21` |

### Editing a sent message (in the transcript)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C122 | status line under the text while the edit is sent (four wordings: "Starting this session…", "Sending your edited message…", "Rewound · sending your edited message…", "Rewinding this session to that message…") | Rewinding this session to that message… | cut | An in-place edit's status line reads "Rewinding…", "Sending…" or "Starting…". | pattern | `src/renderer/src/composer/InlineEdit.tsx:35` |
| C127 | confirmation dialog when a newer turn started during the edit: title "Rewind past a newer turn?", this body, Cancel and "Rewind anyway" | A newer turn started after you began editing. Rewinding discards it too. Rewind anyway? | stays | Stays. kept: consent | not a cut | `src/renderer/src/composer/InlineEdit.tsx:164` |

### Subagent's transcript from another machine, when nothing is held yet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C133 | the only line in the pane (five wordings) | mini holds no rows of this agent’s transcript, and the session’s tree here doesn’t name it | cut | The remote subagent pane reads one of "Reading from mini…", "Nothing from this agent yet" or "mini isn't reachable". | pattern | `src/renderer/src/session/controls/lane-a.ts:98` |

## Approvals, plans and questions

### Hover card on a waiting question (sidebar and waiting list)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| T299 | body of the card while the question loads; state: loading | Loading the question… | reword | While the question loads, the hover card shows the app's small spinner ("Loading the question…" is its accessible name). | pattern | `src/renderer/src/tools/maws/ask/HoverAsk.tsx:32` |

### Request card in the message box's place (any kind)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C82 | first line of the frame that replaces the message box while a request waits | Approval needed · Composer paused · draft preserved | cut | A request card in the box's place starts with its own first line; the frame's "Approval needed · Composer paused · draft preserved" is gone (the kind word stays as the group's accessible name); setup cards with no line of their own still show their title. | seen | `src/renderer/src/composer/docked/DockedCardFrame.tsx:89` |
| C83 | the frame's kind word followed by the card's own first lines: on an approval "Approval needed" then "◐ Run a command"; on a question "Question", then "Question" or "3 questions", then "Main session asks"; on a plan "Plan review", "Plan", "Main session proposes a plan"; on a form "Input requested", the server's name, "<server> asks for input" | Plan review / Plan / Main session proposes a plan | cut | The card opens on one line, the kind's mark and what is asked ("◇ Plan", "? 3 questions", "◐ <server>"), with "· from <agent>" when a subagent asks; the kind word line and the "Main session asks" line are gone. (Partly applied on the scratch branch: The docked frame's own title ("Plan review · Composer paused · draft preserved") lives in composer/docked/DockedCardFrame.tsx (C82, not mine), so docked the frame's kind word still stands above the one line. The hover placement keeps its heading, title and subtitle (a different surface).) | seen | `src/renderer/src/request-card/RequestCard.tsx:180` |
| C84 | under the card when more requests wait behind it | 2 more waiting | cut | When more requests wait behind the card, a small "+2" badge sits on the card's top edge; "2 more waiting" under the pointer. | pattern | `src/renderer/src/composer/Composer.tsx:596` |
| C86 | in the card while the request is fetched | Loading the request… | cut | While the request is fetched the card shows a small spinner in place of the words. | pattern | `src/renderer/src/request-card/RequestCard.tsx:342` |

### Approval card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C90 | under the first line on a terminal-held session that asks in both places | Also asked in the terminal: the first answer wins | cut | On a terminal-held session the card's muted line reads "Also asked in the terminal". | pattern | `src/renderer/src/lane-a/race.ts:14` |
| C92 | under the command or change: a label before the agent's own reason | Why: <the agent's description> | cut | The agent's reason shows as a muted line under the command or change, with no "Why:" label. | seen | `src/renderer/src/request-card/variants/Permission.tsx:84` |
| C93 | in the warning colour, for a tool whose prompt the app cannot draw | <tool> needs its own approval surface, which MAWS does not have · open the session in a terminal to answer it, or deny | cut | A tool the app cannot draw reads "MAWS can't show this prompt · answer it in a terminal, or deny" in the warning colour. | pattern | `src/renderer/src/request-card/variants/Permission.tsx:87` |
| C94 | left end of the button row | Deny… with a reason | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/variants/Permission.tsx:98` |
| C95 | under the reason field once "Deny… with a reason" is pressed | ⌘Enter sends the deny with this reason | stays | Stays. a text field's send-key hint, like the composer's hint the owner brought back (C3); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/request-card/variants/Permission.tsx:92` |
| C98 | last line of the card when "Always allow" is offered | Always allow adds Bash(npm test:*) to .claude/settings.local.json in the project. | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/variants/Permission.tsx:152` |

### Approval card, and the plan card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C99 | link under a long command, a long diff and a long plan (three wordings for one act: "Expand"/"Collapse", "Show all"/"Show less", "Show more"/"Show less") | Show all | cut | Long commands, diffs and plans all expand with "Show all" and fold with "Show less". | seen | `src/renderer/src/request-card/preview/ProposedChange.tsx:50` |

### Waiting request, small card from the sidebar or the Overview

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C100 | under the preview when Allow is offered there | Approve applies to this request only. | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/RequestCard.tsx:443` |
| C101 | tooltips of Deny and Allow once there | Click to allow once | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/RequestCard.tsx:463` |

### Question card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C103 | right of the question's short header when there are several, between two arrows | 1 of 3 | cut | With several questions the card shows one dot per question between the arrows, the current one darker; the position stays in words for screen readers. | seen | `src/renderer/src/request-card/variants/Question.tsx:249` |
| C106 | left end of the button row | Dismiss | stays | Stays. "Dismiss" stays a worded button, as today. The cut adds no × to the card: a × that closes the card while the question keeps waiting is board #705, not this work | brought back | `src/renderer/src/request-card/variants/Question.tsx:263` |

### Questions from the agent (the app's own question sheet), as a card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C108 | the card's whole body | 3 questions · Open the Question sheet | cut | A MAWS ask's card reads "3 questions · Answer…". | pattern | `src/renderer/src/request-card/copy.ts:6` |

### Plan review card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C109 | left end of the button row | Clear context and implement | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/variants/Plan.tsx:113` |

### Model declined card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C112 | title, then a muted line under the engine's guidance | The model declined to continue / Opus 5.5 declined · cyber | cut | The declined card's title reads "Opus 5.5 declined to continue · cyber"; the muted repeat under the guidance is gone. | pattern | `src/renderer/src/request-card/variants/Dialog.tsx:70` |

### Prompt the app cannot answer

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C114 | under a dump of the raw request (two wordings) | MAWS did not declare this dialog kind and cannot answer it · it expires by the engine's dialog timeout | cut | Under the raw request dump the line reads "MAWS can't answer this prompt; it will time out". | pattern | `src/renderer/src/request-card/variants/Dialog.tsx:124` |

### Connector form card

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C115 | left of the buttons, the server's name a second time | <server name> | cut | The connector form's button row no longer repeats the server name. | pattern | `src/renderer/src/request-card/variants/Elicitation.tsx:102` |
| C116 | after a required field's label | (required) | cut | A required field's label ends in an asterisk; screen readers still hear "(required)". | pattern | `src/renderer/src/request-card/variants/Elicitation.tsx:14` |

## Message box

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C2 | in the empty box of a New chat tab | Do anything | cut | A New chat's empty box shows no placeholder; a session with a transcript still says "Ask a follow-up…". | seen | `src/renderer/src/composer/editor/controller.ts:276` |
| C3 | in the empty box whenever a turn is running (replaces the usual placeholder) | Enter to send, ⌘Enter to queue for later | stays | Stays. brought back on session-running-cards, sidebar-hover | brought back | `src/renderer/src/composer/submit/submit-state.ts:73` |
| C4 | in the empty box while a terminal-held session runs a turn | Enter to send | stays | Stays. the composer's key hint (C3 brought back), same box in the terminal-held state | pattern | `src/renderer/src/composer/submit/submit-state.ts:74` |
| C5 | small line under the text while stepping back through earlier prompts with ↑ | History 3/12 · ↓ to restore your draft | stays | Stays. a composer key hint (↓ restores your draft) other than the one brought back; lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/composer/editor/history.ts:90` |
| C8 | beside the Bash chip while nothing is typed yet | Shell command · runs through the engine · output goes to the transcript | cut | Bash mode shows the Bash chip alone, with no hint line beside it. | pattern | `src/renderer/src/composer/modes/bash.ts:8` |
| C10 | top of the menu the Memory chip opens | # appends to | cut | The Memory chip's menu opens straight onto the list of memory files, with no "# appends to" heading. | pattern | `src/renderer/src/composer/modes/ModeChrome.tsx:28` |
| C13 | on an attachment tile whose bytes were too large to save with the draft | not kept in draft | stays | Stays. an exception (attachment not kept in the draft) hidden behind hover; the tile looks normal; lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/composer/frame/AttachmentStrip.tsx:47` |
| C14 | on a file tile while it uploads to another machine (also "Waiting to upload") | Uploading 2 of 5 | stays | Stays. upload count (2 of 5) moves to hover behind a ring; counts of what is in flight are close to the counts the owner brought back \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/composer/frame/AttachmentStrip.tsx:19` |

### Message box, the row of controls under it

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C17 | + menu, Plugins submenu, beside every plugin name | Loaded | cut | The + menu's Plugins submenu lists plugin names alone, with no "Loaded" beside each. | pattern | `src/renderer/src/composer/plus-menu/PlusMenu.tsx:46` |
| C18 | + menu, last two rows of the Connectors and the Plugins submenu | Connectors in this chat… | cut | The last two rows of the Connectors and Plugins submenus read "In this chat…" and "Manage…". | pattern | `src/renderer/src/composer/plus-menu/PlusMenu.tsx:54` |
| C19 | + menu, Plugins submenu when the session lists none | No plugins reported by this session | cut | The Plugins submenu with none says "No plugins". | pattern | `src/renderer/src/composer/plus-menu/PlusMenu.tsx:47` |
| C20 | beside the + after choosing Add directory on a session that was not running (also "Choosing a directory…", "Adding the directory…" inside the menu item) | Starting… | cut | After Add directory on a stopped session the + turns into a spinner while it starts and applies (words under the pointer and for screen readers); the menu item no longer says "Choosing a directory…"/"Adding the directory…", only a real refusal. | pattern | `src/renderer/src/composer/frame/add-directory.ts:21` |
| C21 | second control from the left on a started session: folder name, branch and a dot when there are uncommitted changes | maws · ⎇ master ● | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/composer/frame/LocationChip.tsx:44` |
| C22 | in the location popover under the path, and at the end of the chip's tooltip | The location is fixed once the session starts | cut | The location popover shows the path with no "fixed once the session starts" line, and the chip's tooltip ends at the branch. | pattern | `src/renderer/src/composer/frame/bindings.ts:74` |
| C24 | location popover, at the end of each extra folder | Copy | cut | Each extra folder in the location popover ends with a copy glyph that turns into a tick once copied ("Copy"/"Copied" as its tooltip and name). | pattern | `src/renderer/src/composer/frame/LocationChip.tsx:67` |
| C25 | third control from the left: the permission mode by name (Auto, Manual, Accept edits, Plan, Bypass permissions, Don't ask) | Auto | stays | Stays. kept: consent | not a cut | `src/renderer/src/composer/frame/ModeChip.tsx:64` |
| C26 | same chip on a terminal-held session that reports no mode; tooltip "Not reported by the terminal session: its mode is changed in the terminal" | Mode | stays | Stays. the only word a control has (the mode chip becomes a bare chevron) | pattern | `src/renderer/src/composer/frame/ModeChip.tsx:64` |
| C31 | small notice above the box, with ×, when Auto was asked for and the engine set another mode (three wordings, one of them about cost on a gateway model) | Auto mode isn't available for this session. Using Accept edits instead. | stays | Stays. kept: consent | not a cut | `src/renderer/src/composer/Composer.tsx:569` |
| C32 | tooltip of the microphone button | Click to dictate · on this Mac | cut | The microphone's tooltip reads "Dictate" (with " · hold <chord>" only when a dictation chord is bound, as every icon button's tooltip names its chord). | pattern | `src/renderer/src/composer/dictation/copy.ts:9` |
| C33 | beside the microphone while dictating (also "Asking for permission…", "Finishing…") | Listening… | cut | While listening the microphone is pressed with a pulsing dot beside it, no word; finishing shows a still, faint dot; "Asking for permission…" stays in words. | pattern | `src/renderer/src/composer/dictation/MicControl.tsx:20` |
| C35 | beside the microphone when dictation cannot run for another reason (eight wordings) | Dictation is unavailable · the helper did not start | stays | Stays. an error's cause moves to hover; errors and their way out were not in any picture \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/composer/dictation/copy.ts:19` |
| C36 | right end of the row: the model's name | Opus 5.5 | stays | Stays. brought back on shell-tools, shell-agents-composer-hover | brought back | `src/renderer/src/composer/frame/ModelChip.tsx:56` |
| C37 | inside the model chip, after the name, muted | Fast High | stays | Stays. the model chip under the message box shows the model and the effort ("Sonnet 5 High"); Fast as today | brought back | `src/renderer/src/composer/frame/ModelChip.tsx:57` |
| C38 | inside the model chip after choosing another model, until the engine confirms | setting… | stays | Stays. a pending model change shown only by dimming, which can read as disabled \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/composer/frame/ModelChip.tsx:60` |
| C44 | last control at the right: a ring with no words; this is its tooltip | Context window 43% full of 200k · autocompacts soon | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/composer/frame/ContextRing.tsx:31` |
| C52 | tooltip of the send button, greyed, while a session comes back after an app update | Re-attaching to the engine after the update… | cut | The send button's tooltip after an app update reads "Reconnecting after the update…". | pattern | `src/renderer/src/composer/submit/submit-state.ts:80` |

### Permission mode menu

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C28 | under each of the first four mode names | A classifier approves what is safe and asks for the rest | stays | Stays. kept: consent | not a cut | `src/renderer/src/statusline/mode-menu.ts:28` |

### Context popover (from the ring)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C45 | first line | Context window | stays | Stays. the context popover keeps its heading "Context window" | brought back | `src/renderer/src/statusline/ContextPopover.tsx:96` |
| C46 | the two lines under the heading | 86k of 200k · autocompact at 160k / 43.0% used · 74k until compaction | cut | The context popover's figures are one line, "86k of 200k · compacts at 160k"; the percentage and what is left until compaction under the pointer. | pattern | `src/renderer/src/statusline/ContextPopover.tsx:32` |
| C47 | when there is no reading (three wordings across the ring and the popover: "Not observed yet", "Context window · no reading yet", "Reading the context window…") | Not observed yet | stays | Stays. the context popover keeps "Not observed yet" | brought back | `src/renderer/src/statusline/ContextPopover.tsx:92` |
| C49 | the one button | Compact now | cut | The popover's button reads "Compact". | pattern | `src/renderer/src/statusline/ContextPopover.tsx:103` |

### Mention menu (typing @)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C54 | beside each agent and skill name, its description | <the agent's or skill's own description> | cut | In the @ menu an agent's or skill's description shows only on the highlighted row (arrow keys or pointer), inline on that row. | pattern | `src/renderer/src/composer/mentions/AtMenu.tsx:128` |
| C55 | last line of the Skills group | A skill runs as /name at the start of the message | cut | The Skills group ends at its last skill, with no "A skill runs as /name…" line. | pattern | `src/renderer/src/composer/mentions/AtMenu.tsx:132` |
| C56 | first row while file names are still being searched | Searching files… | cut | While files are searched the Files group's first row is a spinner (words for screen readers). | pattern | `src/renderer/src/composer/mentions/AtMenu.tsx:115` |

### Slash palette (typing /)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C58 | last line of the description popover for the app's own commands | MAWS | cut | The slash palette's popover for the app's own commands no longer ends with "MAWS" (a command with nothing else to say shows no popover). | seen | `src/renderer/src/composer/mentions/SlashPalette.tsx:58` |

### Message box, notices above it

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C61 | one line above the box while a message travels to a session on another machine | Sending to mini… | stays | Stays. skipped: needs the transcript to draw a pending message | not a cut | `src/renderer/src/composer/Composer.tsx:562` |

### Queued messages, above the message box

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C72 | head of the list when sending is paused, with the button Resume (ten wordings by cause) | Queue paused · a background task finished while messages were waiting | stays | Stays. the paused queue keeps its reason on the line | brought back | `src/renderer/src/composer/queue/QueueList.tsx:33` |
| C74 | right end of every waiting message (also "After the turn", "Held", "Sending…") | Next step | stays | Stays. which queue a waiting message is in (Next step / After the turn) hidden at rest; the owner brought back the hint that teaches this queue (C3); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/composer/queue/stack.ts:34` |
| C75 | under a message whose delivery could not be confirmed, with the buttons Resume, Edit, Delete | May not have been delivered · check the transcript, then Resume or Delete | cut | A message whose delivery is unconfirmed says "May not have been delivered" beside Resume, Edit and Delete. | pattern | `src/renderer/src/composer/queue/QueueList.tsx:26` |

### Messages not confirmed yet (terminal-held sessions), above the message box

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C79 | right end of each row, with the buttons "Send again" and "Dismiss" | Not entered: <reason> | cut | A terminal-session send that was refused says "Not sent: <reason>". | pattern | `src/renderer/src/composer/PendingSends.tsx:16` |

### Images and PDFs sent to a terminal session, above the message box

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C81 | beside each file name as it moves along ("Waiting for the turn", "Being read", "Read", "Sent to the model") | Waiting for the turn | stays | Stays. upload states fold to a tick; a file in progress looks the same as one not started \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/composer/PendingUploads.tsx:18` |

### Session held by a terminal (stands where the message box would)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C128 | one line with a mark, then the actions "Attach in a terminal tab", "Take over here", "Fork a copy" | Live in Terminal · pid 4312 · read-only | cut | The held-session line reads "Live in Terminal · read-only"; the pid shows under the pointer on that line. | seen | `src/renderer/src/session/HolderNotice.tsx:11` |
| C129 | second line, fainter, when the terminal's bridge answered but cannot be driven (the bridge's own reason, e.g. "Not in sminos <version>") | <the bridge's reason> | stays | Stays. why a terminal-held session cannot be driven moves to hover; a reason a control is out of reach \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/session/HolderNotice.tsx:35` |

### Session tab and sidebar hover card, terminal-held session (words defined in this part, drawn in another)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C130 | the line naming who holds the session | Running in Terminal · driven through sminos’s bridge | cut | A terminal-held session driven through its bridge reads "Running in Terminal" (a job, "Running as bg · <id>") on the hover card and as the tab marker's title. | pattern | `src/renderer/src/attention/derive.ts:80` |

### Confirmations from the message box

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C138 | toast after a command typed into a terminal-held session ran ("/compact: compacting now", "/model: now <model>, <effort> effort", "/<name>: ran"; about twelve wordings) | /compact: compacting now | stays | Stays. a receipt toast for a command sent to a terminal-held session; whether anything else on screen shows it ran is not known \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/lane-a/outcomes.ts:66` |

### Session row in the sidebar and the Overview (word defined in this part, drawn in another)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C140 | after the title of a session the app stopped to save memory; tooltip "Released at 14:02 to stay under the 8 GB memory budget · Send resumes it" | released | stays | Stays. an invented mark (‖) replacing a plain word, like the "New" badge turned dot the owner brought back (G214) | pattern | `src/renderer/src/budget/copy.ts:32` |

### Relay outage banner

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C153 | banner across the app while ClaudeUsage's relay is down, with "Open ClaudeUsage" and "Retry" | ClaudeUsage's relay stopped answering 3 min ago · 2 live sessions keep their process; their next request fails until it is back · new sessions will offer Direct | cut | The relay banner reads "ClaudeUsage's relay stopped answering 3 min ago · requests fail until it is back". | pattern | `src/renderer/src/gateway/relay-monitor.ts:37` |
| C154 | toast when the relay answers again | Relay is back | cut | When the relay answers again the banner leaves with no toast. | pattern | `src/renderer/src/gateway/relay-monitor.ts:55` |

### Message box, + › Connectors menu

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P578 | the one grey line of the + menu's Connectors submenu when a running session lists no connectors (state: none) | No connectors reported by this session | cut | The + › Connectors submenu says "No connectors". | pattern | `src/renderer/src/widgets/copy.ts:179` |
| P579 | the one grey line of the submenu when the session is not running (state: session not running) | Live details are unavailable until this session is running | cut | The submenu says "Session not running". | pattern | `src/renderer/src/widgets/copy.ts:180` |

## Model menu

### Model menu (opened from the model chip; its code lives outside this part)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C39 | under the effort slider after a change | set · the next init frame confirms it | cut | Under the effort slider (and the fast row) a pending change reads "setting…". | pattern | `src/renderer/src/widgets/copy.ts:283` |
| C40 | last line of the model list | For this session only | cut | No "For this session only" under the model list. | seen | `src/renderer/src/widgets/copy.ts:376` |
| C41 | last line of the model list on a terminal-held session | For this session's own requests from now on; the terminal's status line keeps showing its own | cut | A terminal-held session's last line reads "The terminal's status line won't show this change". | pattern | `src/renderer/src/widgets/copy.ts:378` |
| C42 | under the Default row of the model list | Recommended set of models | cut | The Default row has no "Recommended set of models" line. | seen | `src/renderer/src/widgets/copy.ts:372` |

### Choose a Claude model dialog

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C151 | paragraph under the title | The direct route cannot serve a gateway model · choose one from the Claude group | cut | Under "Choose a Claude model" the line reads "Direct can't use a gateway model." | pattern | `src/renderer/src/gateway/copy.ts:111` |

### Model menu (/model, /effort, /fast)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| P528 | effort view, in place of the level word for a model with no effort levels (state: no levels; the slider is then absent) | No effort setting | stays | Stays. empty state: the effort view of a model with no levels would show nothing to say why | pattern | `src/renderer/src/widgets/copy.ts:364` |
| P531 | effort view, tooltip of the circular-arrow button at the top right | Reset effort to the model's default | cut | The reset button's tooltip reads "Reset effort" (its name keeps the long form). | pattern | `src/renderer/src/widgets/copy.ts:370` |
| P533 | effort view, a quiet line under the slider on a session that is not running (state: session not running), naming the model the engine last ran | Opus 5.5 · Last observed 5 minutes ago | stays | Stays. which model the engine last ran, and when, moves to hover in the effort view; close to the model-in-use fact the owner brought back \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/widgets/ModelSelector.tsx:554` |
| P534 | either view, a note with a blue rule when a gateway (GPT) model is shown and the session is in auto mode (state: gateway model in auto mode); about 35 words | Auto-mode reviews for this model run locally. A GPT route carries no Anthropic verdict, so the engine reviews each tool call itself on Sonnet 5 through {account}. Those requests count against usage. | cut | The gateway note is one sentence: "Auto-mode reviews run locally and count against <account>." | pattern | `src/renderer/src/widgets/copy.ts:310` |
| P535 | either view, a quiet status line while the model list is being read (state: reading) | Reading the models… | cut | While the models are read (or the session starts) the status line is a spinner. | pattern | `src/renderer/src/widgets/copy.ts:375` |
| P537 | either view, in amber when the typed command named something unknown (state: /model or /effort typed with a wrong name); the other is "No effort level named {word}" | No model named {name} in the engine's catalogue | cut | A wrong /model name says "No model named <name>". | pattern | `src/renderer/src/widgets/copy.ts:285` |
| P541 | effort view, the quiet line under "Fast mode" when there is nothing else to say; "Off until turned on here" is the same line for a session where it was never turned on | On / Off | cut | The fast-mode row has no On/Off line when there is nothing else to say. | pattern | `src/renderer/src/widgets/copy.ts:316` |
| P543 | effort view, tooltip of the fast-mode switch; it repeats the label beside it ("Fast mode is for Opus" replaces it on a model without fast mode, and that one is kept) | Fast mode | cut | The fast-mode switch has no tooltip unless it is greyed (its reason stays). The reason for a greyed control needs an owner that takes keyboard focus; see "What the cut builds" in the root document. | pattern | `src/renderer/src/widgets/ModelSelector.tsx:584` |
| P544 | model view (one step in, from the model's name), the heading beside the back chevron | Select model | cut | The model view's heading reads "Model" (its group name stays "Select model"). | seen | `src/renderer/src/widgets/copy.ts:360` |
| P549 | model view, at the right of the checked row while the change is on its way (state: change pending) | setting… | cut | The checked model row shows a small spinner in place of its check while the change is on its way. | pattern | `src/renderer/src/widgets/copy.ts:374` |
| P551 | model view, in place of the rows when the engine listed none (state: empty list) | The engine listed no models | cut | An empty model list says "No models". | pattern | `src/renderer/src/widgets/copy.ts:284` |
| P552 | model view on a new chat set to Direct, a sentence above the greyed gateway models (state: unstarted tab on the direct route) | The direct route cannot serve these; choosing one starts the session on the relay | cut | No sentence above the greyed gateway models; picking one asks "Start on the relay?" as before. | pattern | `src/renderer/src/widgets/copy.ts:302` |
| P555 | model view, the faint last line under the list on a new chat (state: unstarted tab) | Applies when the session starts | cut | No faint "Applies when the session starts" under a new chat's model list. | pattern | `src/renderer/src/widgets/copy.ts:314` |

## Dialogs a session opens

### Memory budget, "Sessions holding work" sheet

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C142 | paragraph under the title | MAWS is using 9.1 GB of its 8 GB memory budget, and every live session holds something stopping it would lose. Nothing is stopped unless you stop it. | cut | The sheet's paragraph reads "9.1 GB of 8 GB in use. Nothing is stopped unless you stop it." | pattern | `src/renderer/src/budget/copy.ts:49` |

### Memory budget, stop confirmation

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C144 | paragraph under the title Stop "<session>"? | Ends its engine process. The session stays in the sidebar with its transcript, queue and session grants; resume it from its row. | stays | Stays. kept: consent | not a cut | `src/renderer/src/budget/copy.ts:55` |

### Resume session dialog

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C155 | top left, followed by the project it is scoped to | Resume session | cut | The dialog's top left shows only the project it is scoped to; "Resume session" stays as the dialog's accessible title. | pattern | `src/renderer/src/resume/copy.ts:4` |
| C156 | in the search field | Search by title, folder, or branch | cut | The search field's placeholder reads "Search sessions"; its accessible name keeps the full wording. | pattern | `src/renderer/src/resume/copy.ts:6` |
| C158 | the key printed inside three of the filter chips (⌃A, ⌃B, ⌃W) | All projects ⌃A | cut | The filter chips show only their names; each chip's key (⌃A, ⌃B, ⌃W) shows on hover. | pattern | `src/renderer/src/resume/ResumeChooser.tsx:254` |
| C159 | under the list when it is cut off | Showing 200 of 1,340. Scroll for more, or type to narrow the list. | cut | Under a cut-off list a faint line reads "200 of 1,340". | pattern | `src/renderer/src/resume/copy.ts:13` |
| C161 | foot of the dialog | ↑↓ navigate ⏎ open ⌘⏎ new tab esc close | stays | Stays. the only place that teaches ⌘⏎ opens in a new tab; like the composer's key hint the owner brought back (C3); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/resume/copy.ts:15` |
| C162 | preview on the right: a label before each fact (Folder, Branch, Project, Last active, Last answer, Machine) | Folder | stays | Stays. labels before the facts go, the facts stay; a bare project name under a bare folder path may not read as either \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/resume/copy.ts:16` |
| C163 | preview on the right: heading over the last few messages | Where you left off | stays | Stays. a heading that splits the preview's facts from its messages; group headings came back elsewhere \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/resume/copy.ts:17` |

### Start-up repair window (when the background service will not start)

| Id | Where | Today | Decision | After | Basis | Source |
|---|---|---|---|---|---|---|
| C166 | paragraph under the headline (three wordings) | MAWS runs its sessions, terminals and index in a background process, mawsd, and could not load or start it: <why>. If MAWS is turned off in System Settings › General › Login Items & Extensions, under Allow in the Background, turn it on, then come back to this window. | cut | The repair window's paragraph gives the cause and the fix only (e.g. "<why>. If MAWS is off in System Settings › General › Login Items & Extensions, turn it on and come back."); the other kinds are cut the same way. | pattern | `src/renderer/src/repair/copy.ts:33` |
| C168 | left of the buttons while a retry runs | Starting mawsd… | cut | Left of the buttons during a retry it reads "Starting…". | pattern | `src/renderer/src/repair/copy.ts:6` |
