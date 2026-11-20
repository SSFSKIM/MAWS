# Word cut: The conversation and the message box

> Part of `docs/doperpowers/specs/2026-11-16-word-cut-design.md`; read that first. This file is written by `render.py` from `items.json` beside it; a decision changes there and in the root document's Decision Log.

172 items: 114 cut, 3 reworded, 55 stay. Of the 117 that change, the owner saw 24 in a picture or ruled on them; 93 follow the pattern and were not seen.

Against master (M0): 166 unchanged, 3 moot, 2 gone, 1 rewritten by the wave; 8 recorded for the owner. M0 added 29 rows for the UX wave's new text (2 cut, 11 reworded, 16 stay), listed at the end.

Columns: **Id** is the item's id in `items.json`. **Where** is the place on the surface. **Today** is the text at the pin `2c7044231` (an example value where the text is built from data). **Decision** is `cut` (the text leaves the resting surface), `reword` (it changes) or `stays` (today's text is kept; the row is here so that nobody proposes it again). **After** says what the surface shows afterwards, as it was built on the scratch branch and shown in the pictures. **Basis** is how firm the decision is, in the words of the root document's "How firm each decision is". **Source** is the file and line at the pin. **M0** is what the re-reading against master found (see the root document's "M0's record"): `unchanged`, `moved`, `rewritten by the wave`, `gone` or `moot`, with the file and line on master, and for a rewritten row the text master shows and the row decided again by the five rules. **Build** is the milestone that builds the row and the scene whose before and after pictures show it.

## The conversation

### Session transcript, turn line

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T1 | the grey line with a chevron above each turn's work, folding it; one of 9 verb forms (Working, Working for, Worked for, Continued for, Peer session worked for, You stopped after, Stopped after … (engine process exited), Ended for your message after, Failed after) | Worked for 2m 14s | reword | a finished turn's line reads the duration alone ("3s · Ran an agent"): "Worked for" is dropped, the time stays. The exception forms (Stopped, Failed, Ended for your message) keep their words | ruled | `src/renderer/src/transcript/model/copy.ts:57` | unchanged `src/renderer/src/transcript/model/copy.ts:58` | M2 · `shell-tools` |
| T2 | after the verb on a finished turn's line: what the turn did, the first three parts and the rest counted | Edited 3 files, ran 2 commands, searched code, and 4 more actions | reword | A capped caption keeps its first two parts, then names every skill or connector the folded parts used ("ran /dataviz", "used notion"), once each, then "+N" for the rest; no "+N" when nothing else is left out. | brought back | `src/renderer/src/transcript/model/caption.ts:58` | unchanged `src/renderer/src/transcript/model/caption.ts:59` | M2 · `shell-tools` |

### Session transcript, run of tool calls

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T11 | the run line while one of its calls waits for a permission, led by a half-disc glyph in the warning tone | Waiting for approval: `rm -rf build` | stays | Stays. kept: consent | not a cut | `src/renderer/src/transcript/model/copy.ts:210` | unchanged `src/renderer/src/transcript/model/copy.ts:222` | M2 · `session-approval` |
| T13 | an edit call's line inside an opened run; also Created and Deleted | Edited src/app/main.ts +3 −1 | stays | Stays. brought back on shell-tools-open, shell-tools-transcript-view, shell-tools-transcript-view-end | brought back | `src/renderer/src/transcript/model/copy.ts:133` | unchanged `src/renderer/src/transcript/model/copy.ts:134` | M2 · `shell-tools-open` |
| T15 | a shell call the engine moved to the background, or one started there | Moved `pnpm dev` to the background after 12s | stays | Stays. the step keeps its fact (in the background) but loses "after 12s"; step durations were neither shown nor named \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:146` | unchanged `src/renderer/src/transcript/model/copy.ts:148` | M2 · no scene: needs a recorded conversation with that event (wanted: a finished turn in which a running shell call was moved to the background (a message sent mid-turn)) |
| T17 | an artifact screenshot call's line | Screenshot of Q3 plan v3 (1280 × 800) | cut | An artifact screenshot call reads "Screenshot of Q3 plan", with no version or pixel size. | pattern | `src/renderer/src/transcript/model/copy.ts:589` | unchanged `src/renderer/src/transcript/model/copy.ts:644` | M2 · `r2-disk-artifacts` |

### Session transcript, an opened call

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T18 | opened shell call: three text buttons, one beside the command and two in the footer | Copy command · Copy output · Copy all | cut | An opened shell call has one copy glyph in its footer (copies everything); hovering the command or the output shows a copy glyph for just that part. | pattern | `src/renderer/src/transcript/view/cells/ShellDetail.tsx:47` | unchanged `src/renderer/src/transcript/view/cells/ShellDetail.tsx:47` | M2 · `shell-tools-open` |
| T19 | opened shell call, under a command longer than 8 lines | Show more command | cut | The toggle under a long command reads "Show more" / "Show less". | pattern | `src/renderer/src/transcript/view/cells/ShellDetail.tsx:50` | unchanged `src/renderer/src/transcript/view/cells/ShellDetail.tsx:50` | M2 · `shell-tools-open` |
| T20 | opened shell call, under the command, when the command ran in the session's own folder | Session directory ~/project | cut | An opened shell call no longer names the folder when the command ran in the session's own folder; a different cwd is still named. | pattern | `src/renderer/src/transcript/view/cells/ShellDetail.tsx:53` | unchanged `src/renderer/src/transcript/view/cells/ShellDetail.tsx:53` | M2 · `shell-tools-open` |
| T22 | opened shell call, footer, after a successful command | ✓ Exit code 0 · 3s | cut | A successful shell call's footer shows only its time ("3s"); a failed one keeps "✕ Exit code 1 · 3s". | pattern | `src/renderer/src/transcript/model/copy.ts:186` | unchanged `src/renderer/src/transcript/model/copy.ts:198` | M2 · `shell-tools-open` |
| T26 | opened call while its full result loads | Loading the full result… | cut | While a spilled result loads, a small spinning ring stands where the Load button was (the words are its accessible name and hover). | pattern | `src/renderer/src/transcript/model/copy.ts:379` | unchanged `src/renderer/src/transcript/model/copy.ts:406` | M2 · no scene: a transient wait no fixture holds (wanted: an opened call with a spilled result, Load full result pressed while the read is pending) |
| T28 | opened edit call: a + or − sign before every changed line | + / − | stays | Stays. diff + and − signs become colour bars; a glyph swap no picture showed, and colour alone carries the sign \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/view/cells/EditDetail.tsx:59` | unchanged `src/renderer/src/transcript/view/cells/EditDetail.tsx:59` | M2 · `shell-tools-open` |
| T31 | opened MCP call: a heading repeating the server and tool the line above already names | github · create_issue | cut | An opened MCP call no longer repeats "github · create_issue" in its heading; only the Raw toggle sits there. | pattern | `src/renderer/src/transcript/view/cells/McpDetail.tsx:58` | unchanged `src/renderer/src/transcript/view/cells/McpDetail.tsx:58` | M2 · `shell-explore-open` |
| T34 | last line of every opened call in a turn auto mode reviewed, when the call passed | Auto mode · reviewed · not flagged | stays | Stays. "reviewed · not flagged" is a passing verdict; the owner brought back passing statuses that assure (Connected, saved) but left lifecycle words cut \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:217` | unchanged `src/renderer/src/transcript/model/copy.ts:229` | M2 · no scene: needs a recorded conversation with that event (wanted: a turn auto mode reviewed, an opened call that passed) |

### Session transcript, thinking

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T36 | a line of its own for each thinking block of ten seconds or more, inside a run or beside it, opening to the thought's text; "Thought" when no time was recorded | Thought for 14s | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/transcript/model/copy.ts:192` | unchanged `src/renderer/src/transcript/model/copy.ts:204` | M2 · no scene: needs a recorded conversation with that event (wanted: a live thinking block of ten seconds or more that has ended (disk replay records no duration)) |
| T37 | while a thinking block streams, shimmering and warming in colour after 10 s; tiers Thinking, Still thinking, Thinking more, Thinking some more, Deep in thought | Thinking some more with high effort · 34s | cut | A streaming thought reads "Thinking some more · 34s" with no effort words. | pattern | `src/renderer/src/transcript/model/copy.ts:200` | unchanged `src/renderer/src/transcript/model/copy.ts:212` | M2 · no scene: a transient wait no fixture holds (wanted: a thinking block streaming for ten seconds or more) |

### Session transcript, your message

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T41 | under a dimmed message sent while a turn runs; 2 forms (Sends at the next step, Sends when this turn ends) | Sends at the next step | stays | Stays. when a queued message will send moves to hover behind a dashed outline; the owner brought back the hint that teaches the two queues (C3) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:324` | unchanged `src/renderer/src/transcript/model/copy.ts:351` | M2 · `r2-queue` |
| T42 | under a message the engine took in the middle of a turn | Sent during this turn | cut | A message the engine took mid-turn has no "Sent during this turn" caption. | pattern | `src/renderer/src/transcript/model/copy.ts:325` | unchanged `src/renderer/src/transcript/model/copy.ts:352` **For the owner, not built: U3 (arrival table, class own) and U4 (l3-input) say a message that entered a running turn is captioned "Sent during this turn" and that this caption stays; cutting it would change a text the wave fixed** | M2 · no scene: needs a recorded conversation with that event (wanted: a message sent while a turn runs that the engine took mid-turn (a steer), shown inside the finished turn) |
| T45 | chip on a message sent from an artifact, naming the version that went with it | Q3 plan, read at revision 3 | cut | The chip on a message sent from an artifact reads "Q3 plan · rev 3". | pattern | `src/renderer/src/transcript/model/user-text.ts:116` | unchanged `src/renderer/src/transcript/model/user-text.ts:115` | M2 · no scene: needs a recorded conversation with that event (wanted: a message sent from an open artifact, with the artifact read attached) |

### Session transcript, time separator

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T47 | centred between messages after an hour's gap before your message, or ten minutes before the engine's; 4 forms (Today, Yesterday, weekday, date) | Today 2:14 PM | stays | Stays. brought back on shell-tools | brought back | `src/renderer/src/transcript/model/time.ts:62` | unchanged `src/renderer/src/transcript/model/time.ts:62` | M2 · no scene: needs a recorded conversation with that event (wanted: a transcript whose messages are more than an hour apart) |

### Session transcript, boundary line

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T48 | a ruled line where the context was compacted; also "Compacted earlier · 152k → 31k" for history | Context compacted · 152k → 31k tokens · auto | cut | A compaction line reads "Compacted · 152k → 31k", for live and earlier compactions alike. | seen | `src/renderer/src/transcript/model/copy.ts:281` | unchanged `src/renderer/src/transcript/model/copy.ts:298` | M2 · `r2-disk-compact` |
| T49 | a ruled line where the conversation was reset; "· after plan approval" or "· cleared" follows | Conversation reset · after plan approval | cut | A reset line reads "Reset after plan approval", or "Cleared". | pattern | `src/renderer/src/transcript/model/copy.ts:284` | unchanged `src/renderer/src/transcript/model/copy.ts:301` | M2 · no scene: needs a recorded conversation with that event (wanted: a session with a conversation-reset boundary (plan approval clearing context)) |
| T50 | a ruled line where the session went on from an earlier message, with a second sentence under it | Conversation continued from an earlier point · Later messages from the previous path are no longer part of the current conversation history | cut | The branch line reads "Continued from an earlier point"; the sentence about later messages is its hover. | pattern | `src/renderer/src/transcript/model/copy.ts:293` | unchanged `src/renderer/src/transcript/model/copy.ts:310` | M2 · no scene: needs a recorded conversation with that event (wanted: a session continued from an earlier message (transcript branch)) |
| T52 | a ruled line where you rewound, with a Show or Hide button | Rewound to here · 3 messages hidden Show | cut | A rewind line reads "Rewound · 3 hidden Show". | pattern | `src/renderer/src/transcript/model/copy.ts:296` | unchanged `src/renderer/src/transcript/model/copy.ts:313` | M2 · `m0-disk-rewind` |

### Session transcript, error or notice line

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T56 | the line left behind once a reconnect or a resume succeeded; 2 forms (Reconnected, Resumed) | Reconnected | cut | A session resumed after a release leaves no "Resumed" line (a reconnect already left none). | pattern | `src/renderer/src/transcript/model/copy.ts:303` | unchanged `src/renderer/src/transcript/model/copy.ts:320` | M2 · `r2-disk-notices` |
| T57 | a notice where MAWS stopped an idle session's process; 2 forms | Released to stay under the memory budget · sending resumes it | cut | A released session's notice reads "Paused to save memory · send to resume" or "Paused while idle · send to resume". | pattern | `src/renderer/src/transcript/model/copy.ts:305` | unchanged `src/renderer/src/transcript/model/copy.ts:322` | M2 · `r2-disk-notices` |
| T58 | while a paused session starts again | Resuming… | cut | While a released session starts again, no "Resuming…" line is drawn; the session's own running mark shows it. | pattern | `src/renderer/src/transcript/model/copy.ts:307` | unchanged `src/renderer/src/transcript/model/copy.ts:324` | M2 · no scene: needs a recorded conversation with that event (wanted: a released session being resumed by a send) |
| T59 | a notice after an app update could not keep the running engine | The engine could not be re-attached after the update; the session was resumed. | cut | After an update that could not keep the engine, the notice reads "Resumed after the update". | pattern | `src/renderer/src/transcript/model/copy.ts:310` | unchanged `src/renderer/src/transcript/model/copy.ts:327` | M2 · no scene: needs a recorded conversation with that event (wanted: a session whose engine could not be re-attached after an app update) |
| T64 | a bordered bar where history is missing; 4 forms (not available, too large on a machine ×2, N items too large) | This session’s earlier history on studio is too large to show here yet; new messages appear below as the session goes on | cut | The missing-history bar's long form reads "Earlier history on studio is too large to show"; the other three forms are as before. | pattern | `src/renderer/src/transcript/model/gap.ts:18` | unchanged `src/renderer/src/transcript/model/gap.ts:18` | M2 · no scene: needs a session on another machine whose earlier history is too large; no fixture machine yields it |
| T65 | a note over a reply the interrupt cut off; a second sentence when only its end was kept | Cut off by the interrupt: the session didn’t keep it. Only its end was kept, so it starts partway through | cut | The note over a reply the interrupt cut reads "Cut off · not kept by the session", and "· starts partway" when only its end was kept. | pattern | `src/renderer/src/transcript/view/rows/AssistantText.tsx:26` | unchanged `src/renderer/src/transcript/view/rows/AssistantText.tsx:34` | M2 · `r2-disk-interrupted` |

### Session transcript, replayed command

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T66 | footer under the output of a ! command you ran yourself | exit 0 | cut | A ! command you ran shows no "exit 0" footer; a non-zero exit keeps it. | pattern | `src/renderer/src/transcript/model/copy.ts:326` | unchanged `src/renderer/src/transcript/model/copy.ts:353` | M2 · `r2-disk-local` |
| T67 | header over the text a slash command printed | Command output | cut | A slash command's printed output has no "Command output" header. | seen | `src/renderer/src/transcript/model/copy.ts:320` | gone: U3b (O-18) turned the slash command output into a light "⎿ output" line with no heading; LOCAL_COMMAND_HEADER is deleted from copy.ts and LocalCommand.tsx draws no heading | — |

### Session transcript, notice line

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T68 | a dot-led line where a scheduled task opened a turn | Running scheduled task · Check the nightly build | cut | A scheduled task's line reads "Scheduled · Check the nightly build". | pattern | `src/renderer/src/transcript/model/copy.ts:250` | unchanged `src/renderer/src/transcript/model/copy.ts:265` **For the owner, not built: U3 arrival table fixes the schedule notice as "● Running scheduled task · <first line>", marked "stays"; the cut (Scheduled · ...) would change a text the wave fixed** | M2 · `r2-disk-notices` |
| T70 | a dot-led line where the bridge woke the session | sminos bridge woke the session to read a message it had not read | cut | The bridge's wake line reads "Woken to read a message". | pattern | `src/renderer/src/transcript/model/copy.ts:253` | unchanged `src/renderer/src/transcript/model/copy.ts:268` **For the owner, not built: U3 arrival table fixes the wake notice as "● sminos bridge woke the session to read a message it had not read" (today's words); the cut would change a text the wave fixed** | M2 · `r2-disk-notices` |
| T71 | at the end of a finished background task's notice | · 12s | stays | Stays. a finished background task's duration moves to hover; near the turn duration the owner brought back (T1); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/transcript/view/rows/Notice.tsx:26` | unchanged `src/renderer/src/transcript/view/rows/Notice.tsx:26` | M2 · `r2-disk-notices` |

### Session transcript, message between agents

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T73 | a ›-led line for each message to or from a subagent or another session; 3 lead-ins (Message from, Report from, Sent to) | Message from @reviewer: The migration is safe to run | cut | A message line leads with an arrow for its direction (← from, → to) and then the name and preview; "Report from" keeps its words and the › mark. | seen | `src/renderer/src/transcript/model/copy.ts:237` | unchanged `src/renderer/src/transcript/model/copy.ts:252` **For the owner, not built: U3 (O-12) fixes the message line as "› Message from @<name>: <first line>" and "› Report from <agent>: ..."; the arrow-by-direction form would change the wave's text** | M2 · `shell-agents-open` |
| T74 | at the end of a message this session sent to another; 4 states (Sending, Sent, Not sent, Never answered) | Sent | stays | Stays. "Sent" is a delivery assurance; the owner brought back Connected and asked for the saved status, but left lifecycle words cut; lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/transcript/model/copy.ts:491` | unchanged `src/renderer/src/transcript/model/copy.ts:524` | M2 · `shell-agents-open` |
| T75 | at the end of every message that came from another session | Reply | cut | Reply shows only on hover or focus of the line, as it already did. | pattern | `src/renderer/src/transcript/model/copy.ts:492` | unchanged `src/renderer/src/transcript/model/copy.ts:525` | M2 · no scene: needs a recorded conversation with that event (wanted: a message from another session that can be replied to (replyTo set)) |
| T76 | the reply box after pressing Reply or Message: a label over the field | Reply via Fix flaky upload test | cut | The reply box has no label above it; its placeholder reads "Reply to reviewer, via Fix flaky upload test…" (the old label is the field's accessible name). | pattern | `src/renderer/src/transcript/model/copy.ts:494` | unchanged `src/renderer/src/transcript/model/copy.ts:527` | M2 · no scene: needs a recorded conversation with that event (wanted: a message from another session with Reply pressed, the reply box open) |
| T79 | the reply box, a status line above the field after sending; 7 forms in 2 modes (Asked S to reply · 12s; … · S sends it at its next tool boundary or when this turn ends; … · S is inside a long tool call; it sends it when that call returns or this turn ends; S is replying with SendMessage; S replied with SendMessage; …, in its own words; Reply failed: …) | Asked Fix flaky upload test to reply · 48s · Fix flaky upload test is inside a long tool call; it sends it when that call returns or this turn ends | cut | The line over the reply box reads "Sending · 48s", then "Sent" or "Sent, reworded"; why it waits and how it was sent are its hover; failures keep "Reply failed: …". | pattern | `src/renderer/src/transcript/model/copy.ts:500` | unchanged `src/renderer/src/transcript/model/copy.ts:533` | M2 · no scene: needs a recorded conversation with that event (wanted: a reply sent to another session, the status line over the reply box) |

### Session transcript, agents listing

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T81 | a whole block wherever the agent listed its agents: a self line, up to three headed sections, a row per agent with its ref, extras and a Message button, then notes | This session is lead [a1b2] · Subagents · 3 · Teammates · 2 · Peer sessions · 4 · … | cut | An agent listing is one line, "Listed 9 agents", with a chevron; opening it shows the sections, rows and notes. | pattern | `src/renderer/src/transcript/view/rows/AgentList.tsx:36` | unchanged `src/renderer/src/transcript/view/rows/AgentList.tsx:36` | M2 · no scene: needs a recorded conversation with that event (wanted: a turn where the agent listed its agents and sessions) |
| T82 | first line of the block | This session is lead [a1b2] | cut | The listing no longer has a "This session is lead [a1b2]" line. | pattern | `src/renderer/src/transcript/model/copy.ts:515` | unchanged `src/renderer/src/transcript/model/copy.ts:548` | M2 · no scene: needs a recorded conversation with that event (wanted: a turn where the agent listed its agents and sessions) |
| T84 | at the end of every agent's row | Message | cut | Each agent row's Message button shows only on hover or focus of the row (and stays while its box is open). | pattern | `src/renderer/src/transcript/model/copy.ts:517` | unchanged `src/renderer/src/transcript/model/copy.ts:550` | M2 · no scene: needs a recorded conversation with that event (wanted: a turn where the agent listed its agents and sessions) |
| T85 | in place of the block while the listing call is out; and when it never returned | Listing the agents and sessions… | cut | While the listing call is out it reads "Listing agents…"; the never-answered form is unchanged. | pattern | `src/renderer/src/transcript/model/copy.ts:513` | unchanged `src/renderer/src/transcript/model/copy.ts:546` | M2 · no scene: a transient wait no fixture holds (wanted: a turn where the agent listed its agents and sessions, the call still out) |

### Session transcript, agents started

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T86 | a line with a glyph per agent wherever the session started or finished subagents; 4 endings (started working, finished, finished with errors, was stopped) | Explore, Plan and 2 more started working | cut | The subagent line shows the agents' glyphs and names with no verb, a spinning ring before them while they work; "· with errors" and "· stopped" keep their words. (Partly applied on the scratch branch: The existing glyphs serve as the per-agent chips; a per-agent state dot was not added, because the row carries only the group's status, not each agent's.) | seen | `src/renderer/src/transcript/model/copy.ts:225` | unchanged `src/renderer/src/transcript/model/copy.ts:239` | M2 · `r2-run-transcript` |
| T87 | under that line while agents work: one line per agent | Explore · Grep · 1m 12s | cut | The per-agent "Explore · Grep · 1m 12s" lines under a working subagent row are gone; each agent's glyph (or a single agent's line) shows that text on hover. | seen | `src/renderer/src/transcript/model/copy.ts:232` | unchanged `src/renderer/src/transcript/model/copy.ts:247` | M2 · `r2-run-transcript` |

### Session transcript, plan

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T88 | header of the bordered plan card | Plan | stays | Stays. the plan card loses its only name ("Plan"); the owner kept the request card's "◇ Plan"; the header may read empty \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:264` | unchanged `src/renderer/src/transcript/model/copy.ts:279` | M2 · no scene: needs a recorded conversation with that event (wanted: a session whose plan was decided, the plan row in the transcript) |
| T89 | badge right of the header while the plan waits | Pending | cut | A waiting plan shows the orange ◐ disc ("Pending" is its accessible name and hover) instead of the badge. | pattern | `src/renderer/src/transcript/model/copy.ts:262` | moot: U1b draws a waiting plan as the request card in the plan row's place (Row.tsx:55 WaitingRow); PlanRow's badge reads the lasting receipt instead of Pending (Plan.tsx), so no waiting plan shows "Pending" | — |
| T90 | badge right of the header once decided; 3 forms (Implemented, Cleared context and implemented, Kept planning: feedback) | Cleared context and implemented | cut | A decided plan's badge reads "Approved", "Approved, context cleared" or "Kept planning: …". | pattern | `src/renderer/src/transcript/model/copy.ts:260` | unchanged `src/renderer/src/transcript/model/copy.ts:275` | M2 · no scene: needs a recorded conversation with that event (wanted: a session whose plan was decided, the plan row in the transcript) |

### Session transcript, questions card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T93 | top row of the card for questions the agent sent through MAWS (an icon, a title, a count, a state chip, a button): the title when the agent gave none | Questions | cut | A question capsule with no title of its own shows its count ("3 questions") as its heading. | seen | `src/renderer/src/transcript/model/copy.ts:418` | unchanged `src/renderer/src/transcript/model/copy.ts:445` | M2 · `r2-disk-ask` |
| T94 | the count after the title | Asked 3 questions | cut | The count reads "3 questions". | seen | `src/renderer/src/transcript/model/copy.ts:419` | unchanged `src/renderer/src/transcript/model/copy.ts:446` | M2 · `r2-disk-ask` |
| T95 | state chip while the card waits; 2 forms (Waiting for you, Asked, answer when ready) | Asked, answer when ready | stays | Stays. the orange disc for a blocking ask is the waiting mark's proper use, but a hollow disc for "not blocking" is a new mark no picture showed \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/model/copy.ts:420` | unchanged `src/renderer/src/transcript/model/copy.ts:447` | M2 · no scene: needs a recorded conversation with that event (wanted: a non-blocking question asked and not yet answered) |
| T96 | state chip once answered | Answered | stays | Stays. the questions card keeps its state mark: "Answered", "Partially answered", "Not answered" | ruled | `src/renderer/src/transcript/model/copy.ts:420` | unchanged `src/renderer/src/transcript/model/copy.ts:447` | M2 · `r2-disk-ask` |
| T97 | state chip when the questions were withdrawn; 2 forms | Cancelled, the turn was interrupted | cut | A cancelled capsule's chip reads "Cancelled"; why is its hover. | pattern | `src/renderer/src/transcript/model/copy.ts:421` | unchanged `src/renderer/src/transcript/model/copy.ts:448` | M2 · no scene: needs a recorded conversation with that event (wanted: an ask whose call the interrupt withdrew) |
| T98 | the card's button; "View answers" once answered | View answers | cut | An answered capsule has no "View answers" button; its top row is itself the press that opens the answers. "Open" stays while it waits. | seen | `src/renderer/src/transcript/model/copy.ts:423` | unchanged `src/renderer/src/transcript/model/copy.ts:451` **For the owner, not built: U1 keeps "View answers" on an answered capsule as the way to open its answers beside the conversation (with "Open beside" while the form stands); cutting it removes a way in the wave's design keeps (rule 3).** | M2 · `r2-disk-ask` |

### Session transcript, delivered files

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T100 | heading of the block where the agent handed over files; one file is named, several are counted; 4 states (Delivered, Delivering, Could not deliver, … was never answered) | Delivered report.pdf | stays | Stays. the verb on an action line ("Delivered"), like "Edited" (T13); without it a lone filename reads bare | pattern | `src/renderer/src/transcript/model/copy.ts:454` | unchanged `src/renderer/src/transcript/model/copy.ts:487` | M2 · `shell-edit` |
| T101 | beside every delivered file: two text buttons | Open externally · Reveal in Finder | cut | Open externally and Reveal in Finder show only on hover or focus of the file's line; the name itself opens the file. | pattern | `src/renderer/src/transcript/model/copy.ts:458` | unchanged `src/renderer/src/transcript/model/copy.ts:491` | M2 · `shell-edit` |

### Session transcript, artifact line

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T102 | a line with an artifact icon wherever the agent made or updated an artifact; 5 forms (Artifact T · v3, Updated artifact T · v4, Registering artifact T…, … was never answered, Could not register artifact T: …) | Updated artifact Q3 plan · v4 | stays | Stays. the verb on an action line ("Updated artifact"), like "Edited" the owner brought back (T13) | pattern | `src/renderer/src/transcript/model/copy.ts:528` | unchanged `src/renderer/src/transcript/model/copy.ts:561` | M2 · `r2-disk-artifacts` |
| T103 | at the end of the artifact line | Open | cut | The artifact line has no Open button; its name is itself the press that opens the version. | seen | `src/renderer/src/transcript/model/copy.ts:533` | unchanged `src/renderer/src/transcript/model/copy.ts:566` | M2 · `r2-disk-artifacts` |

### Session transcript, browser action

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T105 | after the phrase: how long it took and, sometimes, what it waited for | 1.2s · waited 3.0s for you | cut | A browser action's time and wait ("1.2s · waited 3.0s for you") show only on hover of its line. | seen | `src/renderer/src/transcript/view/rows/BrowserAction.tsx:33` | unchanged `src/renderer/src/transcript/view/rows/BrowserAction.tsx:33` | M2 · `r2-disk-browser` |
| T106 | at the end of the line: up to three text buttons (Show snapshot or Show value, Open, Open tab) | Show snapshot · Open · Open tab | cut | Show snapshot, Open and Open tab show only on hover or focus of the line (and stay while the snapshot is open). | seen | `src/renderer/src/transcript/model/copy.ts:697` | unchanged `src/renderer/src/transcript/model/copy.ts:752` | M2 · `r2-disk-browser` |
| T107 | under the line of an action the interrupt stopped | Cancelled, the turn was interrupted | cut | An action the interrupt stopped is noted "Cancelled". | pattern | `src/renderer/src/transcript/model/copy.ts:695` | unchanged `src/renderer/src/transcript/model/copy.ts:750` | M2 · no scene: needs a recorded conversation with that event (wanted: a browser action stopped by the interrupt) |

### Session transcript, side thread line

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T109 | a line with a thread icon wherever a side thread was opened from this session, with an Open button; 3 states (opened, finished · N turns: …, ended with an error) | Side thread on `main.ts:42` finished · 3 turns: Renamed the helper Open | stays | Stays. "Side thread on … finished · 3 turns" becomes an icon and the file; the kind word is cut like the "Edited" verb that came back (T13) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/view/rows/SideThread.tsx:24` | unchanged `src/renderer/src/transcript/view/rows/SideThread.tsx:24` | M2 · no scene: needs a recorded conversation with that event (wanted: a side thread opened from the session) |

### Session transcript, waiting request

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T110 | where a request card would stand, only if no card is registered to draw it | Waiting for you · Bash · answer in the composer | cut | Where no request card is registered, the slot shows the orange ◐ disc and the tool's name; the old sentence is its accessible name and hover. | pattern | `src/renderer/src/transcript/model/copy.ts:267` | moot: U1b (§C) makes no request_slot row any more and the wave's "What goes" list names the placeholder "… answer in the composer"; RequestSlot.tsx draws it only for desk web | — |

### Session transcript, loading and failure states

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T111 | centred in an empty transcript once its history has taken 300 ms | Loading… | cut | An empty transcript whose history is slow to load shows a quiet spinning ring, no "Loading…". | pattern | `src/renderer/src/transcript/model/copy.ts:388` | unchanged `src/renderer/src/transcript/model/copy.ts:415` | M2 · no scene: needs a recorded conversation with that event (wanted: a session whose history read stays out for over 300 ms) |
| T114 | a bar across the top while a jump pages back to an old message, with Stop | Loading earlier messages to reach the message · 40% | cut | The bar for a jump to an old message reads "Finding the message · 40%". | pattern | `src/renderer/src/transcript/model/copy.ts:395` | unchanged `src/renderer/src/transcript/model/copy.ts:422` | M2 · no scene: a transient wait no fixture holds (wanted: a jump to an old message of a long transcript, the bar while it pages back) |

### Session transcript, the agent's prose

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T119 | inside a chip for an image the agent referred to by path | chart.png · /tmp/out/chart.png | stays | Stays. a path moves to hover; the owner left some where-from cuts (W4, T253) and brought back others (connector path G254) \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/transcript/view/markdown/Link.tsx:78` | unchanged `src/renderer/src/transcript/view/markdown/Link.tsx:143` | M2 · no scene: needs a recorded conversation with that event (wanted: the agent's prose naming an image file by path) |

### Transcript, where a request was raised (while its card stands below)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C85 | a bordered row in the transcript at the tool call that asked | Waiting for you · Bash · answer below ↓ | cut | The transcript's pointer row reads "◐ Bash ↓"; its accessible name keeps the full sentence. | pattern | `src/renderer/src/request-card/InlinePointer.tsx:21` | moot: U1b deleted InlinePointer.tsx; the wave's "What goes" list names the pointer row "Waiting for you · … · answer below ↓" | — |

### Editing a sent message (in the transcript)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C122 | status line under the text while the edit is sent (four wordings: "Starting this session…", "Sending your edited message…", "Rewound · sending your edited message…", "Rewinding this session to that message…") | Rewinding this session to that message… | cut | An in-place edit's status line reads "Rewinding…", "Sending…" or "Starting…". | pattern | `src/renderer/src/composer/InlineEdit.tsx:35` | unchanged `src/renderer/src/composer/InlineEdit.tsx:35` | M2 · no scene: a transient wait no fixture holds (wanted: a sent message edited in place and sent, the rewind in flight) |
| C127 | confirmation dialog when a newer turn started during the edit: title "Rewind past a newer turn?", this body, Cancel and "Rewind anyway" | A newer turn started after you began editing. Rewinding discards it too. Rewind anyway? | stays | Stays. kept: consent | not a cut | `src/renderer/src/composer/InlineEdit.tsx:164` | unchanged `src/renderer/src/composer/InlineEdit.tsx:164` | M2 · no scene: needs a recorded conversation with that event (wanted: an edit of a message after a newer turn started) |

### Subagent's transcript from another machine, when nothing is held yet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C133 | the only line in the pane (five wordings) | mini holds no rows of this agent’s transcript, and the session’s tree here doesn’t name it | cut | The remote subagent pane reads one of "Reading from mini…", "Nothing from this agent yet" or "mini isn't reachable". | pattern | `src/renderer/src/session/controls/lane-a.ts:98` | unchanged `src/renderer/src/session/controls/lane-a.ts:98` | M2 · no scene: needs a subagent transcript on another machine; no fixture machine provides one |

## Approvals, plans and questions

### Hover card on a waiting question (sidebar and waiting list)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| T299 | body of the card while the question loads; state: loading | Loading the question… | reword | While the question loads, the hover card shows the app's small spinner ("Loading the question…" is its accessible name). | pattern | `src/renderer/src/tools/maws/ask/HoverAsk.tsx:32` | unchanged `src/renderer/src/tools/maws/ask/HoverAsk.tsx:32` | M2 · no scene: a loading state that lasts a moment; the fixture answers the read at once |

### Request card in the message box's place (any kind)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C82 | first line of the frame that replaces the message box while a request waits | Approval needed · Composer paused · draft preserved | cut | A request card in the box's place starts with its own first line; the frame's "Approval needed · Composer paused · draft preserved" is gone (the kind word stays as the group's accessible name); setup cards with no line of their own still show their title. | seen | `src/renderer/src/composer/docked/DockedCardFrame.tsx:89` | gone: U1b: no request docks in the box's place any more and DockedCardFrame's title line now reads the title alone ("· Composer paused · draft preserved" removed from every frame) | — |
| C83 | the frame's kind word followed by the card's own first lines: on an approval "Approval needed" then "◐ Run a command"; on a question "Question", then "Question" or "3 questions", then "Main session asks"; on a plan "Plan review", "Plan", "Main session proposes a plan"; on a form "Input requested", the server's name, "<server> asks for input" | Plan review / Plan / Main session proposes a plan | cut | The card opens on one line, the kind's mark and what is asked ("◇ Plan", "? 3 questions", "◐ <server>"), with "· from <agent>" when a subagent asks; the kind word line and the "Main session asks" line are gone. (Partly applied on the scratch branch: The docked frame's own title ("Plan review · Composer paused · draft preserved") lives in composer/docked/DockedCardFrame.tsx (C82, not mine), so docked the frame's kind word still stands above the one line. The hover placement keeps its heading, title and subtitle (a different surface).) | seen | `src/renderer/src/request-card/RequestCard.tsx:180` | unchanged `src/renderer/src/request-card/RequestCard.tsx:204` | M2 · `session-plan` |
| C84 | under the card when more requests wait behind it | 2 more waiting | cut | When more requests wait behind the card, a small "+2" badge sits on the card's top edge; "2 more waiting" under the pointer. | pattern | `src/renderer/src/composer/Composer.tsx:596` | rewritten by the wave `src/renderer/src/request-card/EndRegion.tsx:53`: now "Also waiting"; decided again (pattern): stays, The transcript's end lists the other waiting requests under the small heading "Also waiting", one line each: the kind's mark, its summary, who asked. | M2 · no scene: needs a waiting request of that kind (wanted: a session with two requests waiting at once) |
| C86 | in the card while the request is fetched | Loading the request… | cut | While the request is fetched the card shows a small spinner in place of the words. | pattern | `src/renderer/src/request-card/RequestCard.tsx:342` | unchanged `src/renderer/src/request-card/RequestCard.tsx:399` | M2 · no scene: a loading state that lasts a moment; the fixture answers the read at once |

### Approval card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C90 | under the first line on a terminal-held session that asks in both places | Also asked in the terminal: the first answer wins | cut | On a terminal-held session the card's muted line reads "Also asked in the terminal". | pattern | `src/renderer/src/lane-a/race.ts:14` | unchanged `src/renderer/src/lane-a/race.ts:14` **For the owner, not built: U1 (race note) fixes "Also asked in the terminal: the first answer wins" as staying for a terminal session; the cut would change a text the wave fixed** | M2 · no scene: needs a terminal-held session in that state (wanted: a terminal-held session asking in both the terminal and the app) |
| C92 | under the command or change: a label before the agent's own reason | Why: <the agent's description> | cut | The agent's reason shows as a muted line under the command or change, with no "Why:" label. | seen | `src/renderer/src/request-card/variants/Permission.tsx:84` | unchanged `src/renderer/src/request-card/variants/Permission.tsx:100` **For the owner, not built: U1 (approval card drawing, l4-approvals-05) fixes the line "Why: <the call's own description>"; the cut (no "Why:" label) would change a text the wave fixed** | M2 · `session-approval` |
| C93 | in the warning colour, for a tool whose prompt the app cannot draw | <tool> needs its own approval surface, which MAWS does not have · open the session in a terminal to answer it, or deny | cut | A tool the app cannot draw reads "MAWS can't show this prompt · answer it in a terminal, or deny" in the warning colour. | pattern | `src/renderer/src/request-card/variants/Permission.tsx:87` | unchanged `src/renderer/src/request-card/variants/Permission.tsx:103` | M2 · no scene: needs a waiting request of that kind (wanted: an approval for a tool the app cannot draw) |
| C94 | left end of the button row | Deny… with a reason | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/variants/Permission.tsx:98` | unchanged `src/renderer/src/request-card/variants/Permission.tsx:114` | M2 · `session-approval` |
| C95 | under the reason field once "Deny… with a reason" is pressed | ⌘Enter sends the deny with this reason | stays | Stays. a text field's send-key hint, like the composer's hint the owner brought back (C3); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/request-card/variants/Permission.tsx:92` | unchanged `src/renderer/src/request-card/variants/Permission.tsx:108` | M2 · `r2-deny-reason` |
| C98 | last line of the card when "Always allow" is offered | Always allow adds Bash(npm test:*) to .claude/settings.local.json in the project. | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/variants/Permission.tsx:152` | unchanged `src/renderer/src/request-card/variants/Permission.tsx:168` | M2 · no scene: needs a waiting request of that kind (wanted: an approval that offers Always allow) |

### Approval card, and the plan card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C99 | link under a long command, a long diff and a long plan (three wordings for one act: "Expand"/"Collapse", "Show all"/"Show less", "Show more"/"Show less") | Show all | cut | Long commands, diffs and plans all expand with "Show all" and fold with "Show less". | seen | `src/renderer/src/request-card/preview/ProposedChange.tsx:50` | unchanged `src/renderer/src/request-card/preview/ProposedChange.tsx:50` | M2 · no scene: needs a waiting request of that kind (wanted: an approval for a long command or a long diff) |

### Waiting request, small card from the sidebar or the Overview

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C100 | under the preview when Allow is offered there | Approve applies to this request only. | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/RequestCard.tsx:443` | unchanged `src/renderer/src/request-card/RequestCard.tsx:503` | M2 · `sidebar-hover` |
| C101 | tooltips of Deny and Allow once there | Click to allow once | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/RequestCard.tsx:463` | unchanged `src/renderer/src/request-card/RequestCard.tsx:523` | M2 · `sidebar-hover` |

### Question card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C103 | right of the question's short header when there are several, between two arrows | 1 of 3 | cut | With several questions the card shows one dot per question between the arrows, the current one darker; the position stays in words for screen readers. | seen | `src/renderer/src/request-card/variants/Question.tsx:249` | unchanged `src/renderer/src/request-card/variants/Question.tsx:274` | M2 · `session-question` |
| C106 | left end of the button row | Dismiss | stays | Stays. "Dismiss" stays a worded button, as today. The cut adds no × to the card: a × that closes the card while the question keeps waiting is board #705, not this work | brought back | `src/renderer/src/request-card/variants/Question.tsx:263` | unchanged `src/renderer/src/request-card/variants/Question.tsx:288` | M2 · `session-question` |

### Questions from the agent (the app's own question sheet), as a card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C108 | the card's whole body | 3 questions · Open the Question sheet | cut | A MAWS ask's card reads "3 questions · Answer…". | pattern | `src/renderer/src/request-card/copy.ts:6` | unchanged `src/renderer/src/request-card/copy.ts:6` | M2 · no scene: needs a waiting request of that kind (wanted: a MAWS ask (to-human question sheet) card outside the transcript, e.g. in the Overview) |

### Plan review card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C109 | left end of the button row | Clear context and implement | stays | Stays. kept: consent | not a cut | `src/renderer/src/request-card/variants/Plan.tsx:113` | unchanged `src/renderer/src/request-card/variants/Plan.tsx:121` | M2 · `session-plan` |

### Model declined card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C112 | title, then a muted line under the engine's guidance | The model declined to continue / Opus 5.5 declined · cyber | cut | The declined card's title reads "Opus 5.5 declined to continue · cyber"; the muted repeat under the guidance is gone. | pattern | `src/renderer/src/request-card/variants/Dialog.tsx:70` | unchanged `src/renderer/src/request-card/variants/Dialog.tsx:76` | M2 · no scene: needs a waiting request of that kind (wanted: a model-declined card) |

### Prompt the app cannot answer

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C114 | under a dump of the raw request (two wordings) | MAWS did not declare this dialog kind and cannot answer it · it expires by the engine's dialog timeout | cut | Under the raw request dump the line reads "MAWS can't answer this prompt; it will time out". | pattern | `src/renderer/src/request-card/variants/Dialog.tsx:124` | unchanged `src/renderer/src/request-card/variants/Dialog.tsx:130` | M2 · no scene: needs a waiting request of that kind (wanted: an engine dialog of a kind the app did not declare) |

### Connector form card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C115 | left of the buttons, the server's name a second time | <server name> | cut | The connector form's button row no longer repeats the server name. | pattern | `src/renderer/src/request-card/variants/Elicitation.tsx:102` | unchanged `src/renderer/src/request-card/variants/Elicitation.tsx:102` | M2 · no scene: needs a waiting request of that kind (wanted: a connector form card (elicitation request)) |
| C116 | after a required field's label | (required) | cut | A required field's label ends in an asterisk; screen readers still hear "(required)". | pattern | `src/renderer/src/request-card/variants/Elicitation.tsx:14` | unchanged `src/renderer/src/request-card/variants/Elicitation.tsx:14` | M2 · no scene: needs a waiting request of that kind (wanted: a connector form card (elicitation request)) |

## Message box

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C2 | in the empty box of a New chat tab | Do anything | cut | A New chat's empty box shows no placeholder; a session with a transcript still says "Ask a follow-up…". | seen | `src/renderer/src/composer/editor/controller.ts:276` | unchanged `src/renderer/src/composer/editor/controller.ts:325` | M2 · `new-chat` |
| C3 | in the empty box whenever a turn is running (replaces the usual placeholder) | Enter to send, ⌘Enter to queue for later | stays | Stays. brought back on session-running-cards, sidebar-hover | brought back | `src/renderer/src/composer/submit/submit-state.ts:73` | unchanged `src/renderer/src/composer/submit/submit-state.ts:73` | M2 · `r2-queue` |
| C4 | in the empty box while a terminal-held session runs a turn | Enter to send | stays | Stays. the composer's key hint (C3 brought back), same box in the terminal-held state | pattern | `src/renderer/src/composer/submit/submit-state.ts:74` | unchanged `src/renderer/src/composer/submit/submit-state.ts:74` | M2 · no scene: needs a terminal-held session in that state (wanted: a terminal-held session that is running a turn, the message box open) |
| C5 | small line under the text while stepping back through earlier prompts with ↑ | History 3/12 · ↓ to restore your draft | stays | Stays. a composer key hint (↓ restores your draft) other than the one brought back; lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/composer/editor/history.ts:90` | unchanged `src/renderer/src/composer/editor/history.ts:107` | M2 · `r2-history-step` |
| C8 | beside the Bash chip while nothing is typed yet | Shell command · runs through the engine · output goes to the transcript | cut | Bash mode shows the Bash chip alone, with no hint line beside it. | pattern | `src/renderer/src/composer/modes/bash.ts:8` | unchanged `src/renderer/src/composer/modes/bash.ts:8` | M2 · `m0-composer-bash` |
| C10 | top of the menu the Memory chip opens | # appends to | cut | The Memory chip's menu opens straight onto the list of memory files, with no "# appends to" heading. | pattern | `src/renderer/src/composer/modes/ModeChrome.tsx:28` | unchanged `src/renderer/src/composer/modes/ModeChrome.tsx:28` | M2 · no scene: needs the message box in that state (wanted: the message box in memory mode (typed #), the Memory chip menu open) |
| C13 | on an attachment tile whose bytes were too large to save with the draft | not kept in draft | stays | Stays. an exception (attachment not kept in the draft) hidden behind hover; the tile looks normal; lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/composer/frame/AttachmentStrip.tsx:47` | unchanged `src/renderer/src/composer/frame/AttachmentStrip.tsx:47` | M2 · no scene: needs the message box in that state (wanted: an attachment too large to be kept in the draft) |
| C14 | on a file tile while it uploads to another machine (also "Waiting to upload") | Uploading 2 of 5 | stays | Stays. upload count (2 of 5) moves to hover behind a ring; counts of what is in flight are close to the counts the owner brought back \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/composer/frame/AttachmentStrip.tsx:19` | unchanged `src/renderer/src/composer/frame/AttachmentStrip.tsx:19` | M2 · no scene: needs a session on another machine to upload to; no fixture machine provides one |

### Message box, the row of controls under it

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C17 | + menu, Plugins submenu, beside every plugin name | Loaded | cut | The + menu's Plugins submenu lists plugin names alone, with no "Loaded" beside each. | pattern | `src/renderer/src/composer/plus-menu/PlusMenu.tsx:46` | unchanged `src/renderer/src/composer/plus-menu/PlusMenu.tsx:46` | M2 · `r2-plus-menu` |
| C18 | + menu, last two rows of the Connectors and the Plugins submenu | Connectors in this chat… | cut | The last two rows of the Connectors and Plugins submenus read "In this chat…" and "Manage…". | pattern | `src/renderer/src/composer/plus-menu/PlusMenu.tsx:54` | unchanged `src/renderer/src/composer/plus-menu/PlusMenu.tsx:54` | M2 · `r2-plus-menu` |
| C19 | + menu, Plugins submenu when the session lists none | No plugins reported by this session | cut | The Plugins submenu with none says "No plugins". | pattern | `src/renderer/src/composer/plus-menu/PlusMenu.tsx:47` | unchanged `src/renderer/src/composer/plus-menu/PlusMenu.tsx:47` | M2 · no scene: needs the message box in that state (wanted: the + menu Plugins submenu of a running session that lists no plugins) |
| C20 | beside the + after choosing Add directory on a session that was not running (also "Choosing a directory…", "Adding the directory…" inside the menu item) | Starting… | cut | After Add directory on a stopped session the + turns into a spinner while it starts and applies (words under the pointer and for screen readers); the menu item no longer says "Choosing a directory…"/"Adding the directory…", only a real refusal. | pattern | `src/renderer/src/composer/frame/add-directory.ts:21` | unchanged `src/renderer/src/composer/frame/add-directory.ts:21` | M2 · no scene: needs the message box in that state (wanted: Add directory chosen on a session that is not running) |
| C21 | second control from the left on a started session: folder name, branch and a dot when there are uncommitted changes | maws · ⎇ master ● | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/composer/frame/LocationChip.tsx:44` | unchanged `src/renderer/src/composer/frame/LocationChip.tsx:44` | M2 · `shell-agents-composer-hover` |
| C22 | in the location popover under the path, and at the end of the chip's tooltip | The location is fixed once the session starts | cut | The location popover shows the path with no "fixed once the session starts" line, and the chip's tooltip ends at the branch. | pattern | `src/renderer/src/composer/frame/bindings.ts:74` | unchanged `src/renderer/src/composer/frame/bindings.ts:74` | M2 · no scene: needs the message box in that state (wanted: the location chip opened on a started session) |
| C24 | location popover, at the end of each extra folder | Copy | cut | Each extra folder in the location popover ends with a copy glyph that turns into a tick once copied ("Copy"/"Copied" as its tooltip and name). | pattern | `src/renderer/src/composer/frame/LocationChip.tsx:67` | unchanged `src/renderer/src/composer/frame/LocationChip.tsx:67` | M2 · no scene: needs the message box in that state (wanted: the location chip opened on a session with extra folders) |
| C25 | third control from the left: the permission mode by name (Auto, Manual, Accept edits, Plan, Bypass permissions, Don't ask) | Auto | stays | Stays. kept: consent | not a cut | `src/renderer/src/composer/frame/ModeChip.tsx:64` | unchanged `src/renderer/src/composer/frame/ModeChip.tsx:65` | M2 · `shell-agents-composer-hover` |
| C26 | same chip on a terminal-held session that reports no mode; tooltip "Not reported by the terminal session: its mode is changed in the terminal" | Mode | stays | Stays. the only word a control has (the mode chip becomes a bare chevron) | pattern | `src/renderer/src/composer/frame/ModeChip.tsx:64` | unchanged `src/renderer/src/composer/frame/ModeChip.tsx:65` | M2 · no scene: needs a terminal-held session in that state (wanted: a terminal-held session whose mode the terminal does not report, the chip shown) |
| C31 | small notice above the box, with ×, when Auto was asked for and the engine set another mode (three wordings, one of them about cost on a gateway model) | Auto mode isn't available for this session. Using Accept edits instead. | stays | Stays. kept: consent | not a cut | `src/renderer/src/composer/Composer.tsx:569` | unchanged `src/renderer/src/composer/Composer.tsx:624` | M2 · no scene: needs the message box in that state (wanted: Auto asked for and the engine set another mode) |
| C32 | tooltip of the microphone button | Click to dictate · on this Mac | cut | The microphone's tooltip reads "Dictate" (with " · hold <chord>" only when a dictation chord is bound, as every icon button's tooltip names its chord). | pattern | `src/renderer/src/composer/dictation/copy.ts:9` | unchanged `src/renderer/src/composer/dictation/copy.ts:9` | M2 · no scene: needs the pointer on a control the rig does not hover (wanted: pointer on the microphone button) |
| C33 | beside the microphone while dictating (also "Asking for permission…", "Finishing…") | Listening… | cut | While listening the microphone is pressed with a pulsing dot beside it, no word; finishing shows a still, faint dot; "Asking for permission…" stays in words. | pattern | `src/renderer/src/composer/dictation/MicControl.tsx:20` | unchanged `src/renderer/src/composer/dictation/MicControl.tsx:20` | M2 · no scene: a transient wait no fixture holds (wanted: dictation listening) |
| C35 | beside the microphone when dictation cannot run for another reason (eight wordings) | Dictation is unavailable · the helper did not start | stays | Stays. an error's cause moves to hover; errors and their way out were not in any picture \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/composer/dictation/copy.ts:19` | unchanged `src/renderer/src/composer/dictation/copy.ts:19` | M2 · no scene: needs the message box in that state (wanted: dictation unavailable because the helper did not start) |
| C36 | right end of the row: the model's name | Opus 5.5 | stays | Stays. brought back on shell-tools, shell-agents-composer-hover | brought back | `src/renderer/src/composer/frame/ModelChip.tsx:56` | unchanged `src/renderer/src/composer/frame/ModelChip.tsx:57` | M2 · `shell-agents-composer-hover` |
| C37 | inside the model chip, after the name, muted | Fast High | stays | Stays. the model chip under the message box shows the model and the effort ("Sonnet 5 High"); Fast as today | brought back | `src/renderer/src/composer/frame/ModelChip.tsx:57` | unchanged `src/renderer/src/composer/frame/ModelChip.tsx:58` | M2 · `shell-agents-composer-hover` |
| C38 | inside the model chip after choosing another model, until the engine confirms | setting… | stays | Stays. a pending model change shown only by dimming, which can read as disabled \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/composer/frame/ModelChip.tsx:60` | unchanged `src/renderer/src/composer/frame/ModelChip.tsx:61` | M2 · no scene: a transient wait no fixture holds (wanted: a model just chosen, not yet confirmed by the engine) |
| C44 | last control at the right: a ring with no words; this is its tooltip | Context window 43% full of 200k · autocompacts soon | stays | Stays. skipped: redesign, not a word cut | not a cut | `src/renderer/src/composer/frame/ContextRing.tsx:31` | unchanged `src/renderer/src/composer/frame/ContextRing.tsx:31` | M2 · no scene: needs the pointer on a control the rig does not hover (wanted: pointer on the context ring) |
| C52 | tooltip of the send button, greyed, while a session comes back after an app update | Re-attaching to the engine after the update… | cut | The send button's tooltip after an app update reads "Reconnecting after the update…". | pattern | `src/renderer/src/composer/submit/submit-state.ts:80` | unchanged `src/renderer/src/composer/submit/submit-state.ts:80` | M2 · no scene: a transient wait no fixture holds (wanted: a session being re-attached after an app update) |

### Permission mode menu

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C28 | under each of the first four mode names | A classifier approves what is safe and asks for the rest | stays | Stays. kept: consent | not a cut | `src/renderer/src/statusline/mode-menu.ts:28` | unchanged `src/renderer/src/statusline/mode-menu.ts:28` | M2 · no scene: needs the message box in that state (wanted: the permission mode menu opened from the mode chip) |

### Context popover (from the ring)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C45 | first line | Context window | stays | Stays. the context popover keeps its heading "Context window" | brought back | `src/renderer/src/statusline/ContextPopover.tsx:96` | unchanged `src/renderer/src/statusline/ContextPopover.tsx:96` | M2 · `r2-context-popover` |
| C46 | the two lines under the heading | 86k of 200k · autocompact at 160k / 43.0% used · 74k until compaction | cut | The context popover's figures are one line, "86k of 200k · compacts at 160k"; the percentage and what is left until compaction under the pointer. | pattern | `src/renderer/src/statusline/ContextPopover.tsx:32` | unchanged `src/renderer/src/statusline/ContextPopover.tsx:32` | M2 · `r2-context-popover` |
| C47 | when there is no reading (three wordings across the ring and the popover: "Not observed yet", "Context window · no reading yet", "Reading the context window…") | Not observed yet | stays | Stays. the context popover keeps "Not observed yet" | brought back | `src/renderer/src/statusline/ContextPopover.tsx:92` | unchanged `src/renderer/src/statusline/ContextPopover.tsx:92` | M2 · no scene: needs the message box in that state (wanted: the context popover of a session with no context reading yet) |
| C49 | the one button | Compact now | cut | The popover's button reads "Compact". | pattern | `src/renderer/src/statusline/ContextPopover.tsx:103` | unchanged `src/renderer/src/statusline/ContextPopover.tsx:103` | M2 · `r2-context-popover` |

### Mention menu (typing @)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C54 | beside each agent and skill name, its description | <the agent's or skill's own description> | cut | In the @ menu an agent's or skill's description shows only on the highlighted row (arrow keys or pointer), inline on that row. | pattern | `src/renderer/src/composer/mentions/AtMenu.tsx:128` | unchanged `src/renderer/src/composer/mentions/AtMenu.tsx:132` | M2 · `r2-mention-menu` |
| C55 | last line of the Skills group | A skill runs as /name at the start of the message | cut | The Skills group ends at its last skill, with no "A skill runs as /name…" line. | pattern | `src/renderer/src/composer/mentions/AtMenu.tsx:132` | unchanged `src/renderer/src/composer/mentions/AtMenu.tsx:136` | M2 · `r2-mention-menu` |
| C56 | first row while file names are still being searched | Searching files… | cut | While files are searched the Files group's first row is a spinner (words for screen readers). | pattern | `src/renderer/src/composer/mentions/AtMenu.tsx:115` | unchanged `src/renderer/src/composer/mentions/AtMenu.tsx:119` | M2 · `r2-mention-menu` |

### Slash palette (typing /)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C58 | last line of the description popover for the app's own commands | MAWS | cut | The slash palette's popover for the app's own commands no longer ends with "MAWS" (a command with nothing else to say shows no popover). | seen | `src/renderer/src/composer/mentions/SlashPalette.tsx:58` | unchanged `src/renderer/src/composer/mentions/SlashPalette.tsx:60` | M2 · `r2-slash-menu` |

### Message box, notices above it

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C61 | one line above the box while a message travels to a session on another machine | Sending to mini… | stays | Stays. skipped: needs the transcript to draw a pending message | not a cut | `src/renderer/src/composer/Composer.tsx:562` | unchanged `src/renderer/src/composer/Composer.tsx:617` | M2 · no scene: needs a session on another machine; no fixture machine provides one |

### Queued messages, above the message box

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C72 | head of the list when sending is paused, with the button Resume (ten wordings by cause) | Queue paused · a background task finished while messages were waiting | stays | Stays. the paused queue keeps its reason on the line | brought back | `src/renderer/src/composer/queue/QueueList.tsx:33` | unchanged `src/renderer/src/composer/queue/QueueList.tsx:33` | M2 · `m0-queue-paused` |
| C74 | right end of every waiting message (also "After the turn", "Held", "Sending…") | Next step | stays | Stays. which queue a waiting message is in (Next step / After the turn) hidden at rest; the owner brought back the hint that teaches this queue (C3); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/composer/queue/stack.ts:34` | unchanged `src/renderer/src/composer/queue/stack.ts:64` | M2 · `r2-queue` |
| C75 | under a message whose delivery could not be confirmed, with the buttons Resume, Edit, Delete | May not have been delivered · check the transcript, then Resume or Delete | cut | A message whose delivery is unconfirmed says "May not have been delivered" beside Resume, Edit and Delete. | pattern | `src/renderer/src/composer/queue/QueueList.tsx:26` | unchanged `src/renderer/src/composer/queue/QueueList.tsx:26` | M2 · no scene: needs the message box in that state (wanted: a queued message whose delivery could not be confirmed) |

### Messages not confirmed yet (terminal-held sessions), above the message box

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C79 | right end of each row, with the buttons "Send again" and "Dismiss" | Not entered: <reason> | cut | A terminal-session send that was refused says "Not sent: <reason>". | pattern | `src/renderer/src/composer/PendingSends.tsx:16` | unchanged `src/renderer/src/composer/PendingSends.tsx:16` | M2 · no scene: needs a terminal-held session in that state (wanted: a message sent to a terminal-held session that the terminal refused) |

### Images and PDFs sent to a terminal session, above the message box

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C81 | beside each file name as it moves along ("Waiting for the turn", "Being read", "Read", "Sent to the model") | Waiting for the turn | stays | Stays. upload states fold to a tick; a file in progress looks the same as one not started \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/composer/PendingUploads.tsx:18` | unchanged `src/renderer/src/composer/PendingUploads.tsx:18` | M2 · no scene: needs a terminal-held session in that state (wanted: an image sent to a terminal-held session, waiting for the turn) |

### Session held by a terminal (stands where the message box would)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C128 | one line with a mark, then the actions "Attach in a terminal tab", "Take over here", "Fork a copy" | Live in Terminal · pid 4312 · read-only | cut | The held-session line reads "Live in Terminal · read-only"; the pid shows under the pointer on that line. | seen | `src/renderer/src/session/HolderNotice.tsx:11` | unchanged `src/renderer/src/session/HolderNotice.tsx:11` | M2 · `session-terminal-held` |
| C129 | second line, fainter, when the terminal's bridge answered but cannot be driven (the bridge's own reason, e.g. "Not in sminos <version>") | <the bridge's reason> | stays | Stays. why a terminal-held session cannot be driven moves to hover; a reason a control is out of reach \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/session/HolderNotice.tsx:35` | unchanged `src/renderer/src/session/HolderNotice.tsx:35` | M2 · no scene: needs a terminal-held session in that state (wanted: a terminal-held session whose bridge answered but cannot drive it) |

### Session tab and sidebar hover card, terminal-held session (words defined in this part, drawn in another)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C130 | the line naming who holds the session | Running in Terminal · driven through sminos’s bridge | cut | A terminal-held session driven through its bridge reads "Running in Terminal" (a job, "Running as bg · <id>") on the hover card and as the tab marker's title. | pattern | `src/renderer/src/attention/derive.ts:80` | unchanged `src/renderer/src/attention/derive.ts:80` | M2 · no scene: needs a terminal-held session in that state (wanted: hover on a terminal-held session driven through its bridge) |

### Confirmations from the message box

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C138 | toast after a command typed into a terminal-held session ran ("/compact: compacting now", "/model: now <model>, <effort> effort", "/<name>: ran"; about twelve wordings) | /compact: compacting now | stays | Stays. a receipt toast for a command sent to a terminal-held session; whether anything else on screen shows it ran is not known \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/lane-a/outcomes.ts:66` | unchanged `src/renderer/src/lane-a/outcomes.ts:66` | M2 · no scene: needs a terminal-held session in that state (wanted: a slash command typed into a terminal-held session) |

### Session row in the sidebar and the Overview (word defined in this part, drawn in another)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C140 | after the title of a session the app stopped to save memory; tooltip "Released at 14:02 to stay under the 8 GB memory budget · Send resumes it" | released | stays | Stays. an invented mark (‖) replacing a plain word, like the "New" badge turned dot the owner brought back (G214) | pattern | `src/renderer/src/budget/copy.ts:32` | unchanged `src/renderer/src/budget/copy.ts:32` | M2 · no scene: needs the message box in that state (wanted: a session released to stay under the memory budget) |

### Relay outage banner

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C153 | banner across the app while ClaudeUsage's relay is down, with "Open ClaudeUsage" and "Retry" | ClaudeUsage's relay stopped answering 3 min ago · 2 live sessions keep their process; their next request fails until it is back · new sessions will offer Direct | cut | The relay banner reads "ClaudeUsage's relay stopped answering 3 min ago · requests fail until it is back". | pattern | `src/renderer/src/gateway/relay-monitor.ts:37` | unchanged `src/renderer/src/gateway/relay-monitor.ts:37` | M2 · no scene: needs the message box in that state (wanted: the relay outage banner (ClaudeUsage relay stopped)) |
| C154 | toast when the relay answers again | Relay is back | cut | When the relay answers again the banner leaves with no toast. | pattern | `src/renderer/src/gateway/relay-monitor.ts:55` | unchanged `src/renderer/src/gateway/relay-monitor.ts:55` | M2 · no scene: needs the message box in that state (wanted: the relay answering again after an outage) |

### Message box, + › Connectors menu

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| P578 | the one grey line of the + menu's Connectors submenu when a running session lists no connectors (state: none) | No connectors reported by this session | cut | The + › Connectors submenu says "No connectors". | pattern | `src/renderer/src/widgets/copy.ts:179` | unchanged `src/renderer/src/widgets/copy.ts:179` | M2 · no scene: needs the message box in that state (wanted: the + menu Connectors submenu of a running session that lists none) |
| P579 | the one grey line of the submenu when the session is not running (state: session not running) | Live details are unavailable until this session is running | cut | The submenu says "Session not running". | pattern | `src/renderer/src/widgets/copy.ts:180` | unchanged `src/renderer/src/widgets/copy.ts:180` | M2 · no scene: needs the message box in that state (wanted: the + menu Connectors submenu of a session that is not running) |

## Model menu

### Model menu (opened from the model chip; its code lives outside this part)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C39 | under the effort slider after a change | set · the next init frame confirms it | cut | Under the effort slider (and the fast row) a pending change reads "setting…". | pattern | `src/renderer/src/widgets/copy.ts:283` | unchanged `src/renderer/src/widgets/copy.ts:283` | M2 · no scene: a transient wait no fixture holds (wanted: the model menu right after an effort change is asked for) |
| C40 | last line of the model list | For this session only | cut | No "For this session only" under the model list. | seen | `src/renderer/src/widgets/copy.ts:376` | unchanged `src/renderer/src/widgets/ModelSelector.tsx:669` **Not built: Held for U11b (the default writer: the model menu without its Default row, the write on a pick), designed and not built; the cut does no work on it while U11b stands in the wave's plan, as "Meeting the UX wave" says.** | M2 · `r2-model-menu` |
| C41 | last line of the model list on a terminal-held session | For this session's own requests from now on; the terminal's status line keeps showing its own | cut | A terminal-held session's last line reads "The terminal's status line won't show this change". | pattern | `src/renderer/src/widgets/copy.ts:378` | unchanged `src/renderer/src/widgets/copy.ts:378` | M2 · no scene: needs a terminal-held session in that state (wanted: the model menu of a terminal-held session) |
| C42 | under the Default row of the model list | Recommended set of models | cut | The Default row has no "Recommended set of models" line. | seen | `src/renderer/src/widgets/copy.ts:372` | unchanged `src/renderer/src/widgets/ModelSelector.tsx:660` **Not built: Held for U11b (the default writer), designed and not built; the cut does no work on it while U11b stands in the wave's plan.** | M2 · `r2-model-menu` |

### Choose a Claude model dialog

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C151 | paragraph under the title | The direct route cannot serve a gateway model · choose one from the Claude group | cut | Under "Choose a Claude model" the line reads "Direct can't use a gateway model." | pattern | `src/renderer/src/gateway/copy.ts:111` | unchanged `src/renderer/src/gateway/copy.ts:111` | M2 · no scene: needs the model menu opened in that state (wanted: the Choose a Claude model dialog (a gateway model picked on the direct route)) |

### Model menu (/model, /effort, /fast)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| P528 | effort view, in place of the level word for a model with no effort levels (state: no levels; the slider is then absent) | No effort setting | stays | Stays. empty state: the effort view of a model with no levels would show nothing to say why | pattern | `src/renderer/src/widgets/copy.ts:364` | unchanged `src/renderer/src/widgets/copy.ts:364` | M2 · no scene: needs the model menu opened in that state (wanted: the model menu of a model with no effort levels) |
| P531 | effort view, tooltip of the circular-arrow button at the top right | Reset effort to the model's default | cut | The reset button's tooltip reads "Reset effort" (its name keeps the long form). | pattern | `src/renderer/src/widgets/copy.ts:370` | unchanged `src/renderer/src/widgets/copy.ts:370` | M2 · `r2-model-menu` |
| P533 | effort view, a quiet line under the slider on a session that is not running (state: session not running), naming the model the engine last ran | Opus 5.5 · Last observed 5 minutes ago | stays | Stays. which model the engine last ran, and when, moves to hover in the effort view; close to the model-in-use fact the owner brought back \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/widgets/ModelSelector.tsx:554` | unchanged `src/renderer/src/widgets/ModelSelector.tsx:554` | M2 · `r2-model-menu` |
| P534 | either view, a note with a blue rule when a gateway (GPT) model is shown and the session is in auto mode (state: gateway model in auto mode); about 35 words | Auto-mode reviews for this model run locally. A GPT route carries no Anthropic verdict, so the engine reviews each tool call itself on Sonnet 5 through {account}. Those requests count against usage. | cut | The gateway note is one sentence: "Auto-mode reviews run locally and count against <account>." | pattern | `src/renderer/src/widgets/copy.ts:310` | unchanged `src/renderer/src/widgets/copy.ts:310` | M2 · no scene: needs the model menu opened in that state (wanted: a gateway model shown in the model menu while the session is in auto mode) |
| P535 | either view, a quiet status line while the model list is being read (state: reading) | Reading the models… | cut | While the models are read (or the session starts) the status line is a spinner. | pattern | `src/renderer/src/widgets/copy.ts:375` | unchanged `src/renderer/src/widgets/copy.ts:375` | M2 · `r2-dialog-model` |
| P537 | either view, in amber when the typed command named something unknown (state: /model or /effort typed with a wrong name); the other is "No effort level named {word}" | No model named {name} in the engine's catalogue | cut | A wrong /model name says "No model named <name>". | pattern | `src/renderer/src/widgets/copy.ts:285` | unchanged `src/renderer/src/widgets/copy.ts:285` | M2 · no scene: needs the model menu opened in that state (wanted: /model typed with a name the catalogue lacks) |
| P541 | effort view, the quiet line under "Fast mode" when there is nothing else to say; "Off until turned on here" is the same line for a session where it was never turned on | On / Off | cut | The fast-mode row has no On/Off line when there is nothing else to say. | pattern | `src/renderer/src/widgets/copy.ts:316` | unchanged `src/renderer/src/widgets/copy.ts:316` | M2 · `r2-model-menu` |
| P543 | effort view, tooltip of the fast-mode switch; it repeats the label beside it ("Fast mode is for Opus" replaces it on a model without fast mode, and that one is kept) | Fast mode | cut | The fast-mode switch has no tooltip unless it is greyed (its reason stays). The reason for a greyed control needs an owner that takes keyboard focus; see "What the cut builds" in the root document. | pattern | `src/renderer/src/widgets/ModelSelector.tsx:584` | unchanged `src/renderer/src/widgets/ModelSelector.tsx:584` | M2 · `r2-model-menu` |
| P544 | model view (one step in, from the model's name), the heading beside the back chevron | Select model | cut | The model view's heading reads "Model" (its group name stays "Select model"). | seen | `src/renderer/src/widgets/copy.ts:360` | unchanged `src/renderer/src/widgets/copy.ts:360` | M2 · `r2-model-menu` |
| P549 | model view, at the right of the checked row while the change is on its way (state: change pending) | setting… | cut | The checked model row shows a small spinner in place of its check while the change is on its way. | pattern | `src/renderer/src/widgets/copy.ts:374` | unchanged `src/renderer/src/widgets/copy.ts:374` | M2 · no scene: a transient wait no fixture holds (wanted: the model menu with a pick on its way) |
| P551 | model view, in place of the rows when the engine listed none (state: empty list) | The engine listed no models | cut | An empty model list says "No models". | pattern | `src/renderer/src/widgets/copy.ts:284` | unchanged `src/renderer/src/widgets/copy.ts:284` | M2 · no scene: needs the model menu opened in that state (wanted: the model menu when the engine listed no models) |
| P552 | model view on a new chat set to Direct, a sentence above the greyed gateway models (state: unstarted tab on the direct route) | The direct route cannot serve these; choosing one starts the session on the relay | cut | No sentence above the greyed gateway models; picking one asks "Start on the relay?" as before. | pattern | `src/renderer/src/widgets/copy.ts:302` | unchanged `src/renderer/src/widgets/copy.ts:302` | M2 · no scene: needs the model menu opened in that state (wanted: the model menu of a new chat set to the direct route) |
| P555 | model view, the faint last line under the list on a new chat (state: unstarted tab) | Applies when the session starts | cut | No faint "Applies when the session starts" under a new chat's model list. | pattern | `src/renderer/src/widgets/copy.ts:314` | unchanged `src/renderer/src/widgets/copy.ts:314` **For the owner, not built: U11 (l8-settings-11) says the line under the model list in a chat not yet started keeps "Applies when the session starts"; the cut would change a text the wave fixed** | M2 · no scene: needs the model menu opened in that state (wanted: the model menu of a new chat) |

## Dialogs a session opens

### Memory budget, "Sessions holding work" sheet

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C142 | paragraph under the title | MAWS is using 9.1 GB of its 8 GB memory budget, and every live session holds something stopping it would lose. Nothing is stopped unless you stop it. | cut | The sheet's paragraph reads "9.1 GB of 8 GB in use. Nothing is stopped unless you stop it." | pattern | `src/renderer/src/budget/copy.ts:49` | unchanged `src/renderer/src/budget/copy.ts:49` | M2 · no scene: needs that session dialog opened (wanted: the memory-budget "Sessions holding work" sheet) |

### Memory budget, stop confirmation

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C144 | paragraph under the title Stop "<session>"? | Ends its engine process. The session stays in the sidebar with its transcript, queue and session grants; resume it from its row. | stays | Stays. kept: consent | not a cut | `src/renderer/src/budget/copy.ts:55` | unchanged `src/renderer/src/budget/copy.ts:55` | M2 · no scene: needs that session dialog opened (wanted: the memory-budget stop confirmation) |

### Resume session dialog

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C155 | top left, followed by the project it is scoped to | Resume session | cut | The dialog's top left shows only the project it is scoped to; "Resume session" stays as the dialog's accessible title. | pattern | `src/renderer/src/resume/copy.ts:4` | unchanged `src/renderer/src/resume/copy.ts:4` | M2 · `m0-resume` |
| C156 | in the search field | Search by title, folder, or branch | cut | The search field's placeholder reads "Search sessions"; its accessible name keeps the full wording. | pattern | `src/renderer/src/resume/copy.ts:6` | unchanged `src/renderer/src/resume/copy.ts:6` | M2 · `m0-resume` |
| C158 | the key printed inside three of the filter chips (⌃A, ⌃B, ⌃W) | All projects ⌃A | cut | The filter chips show only their names; each chip's key (⌃A, ⌃B, ⌃W) shows on hover. | pattern | `src/renderer/src/resume/ResumeChooser.tsx:254` | unchanged `src/renderer/src/resume/ResumeChooser.tsx:254` | M2 · `m0-resume` |
| C159 | under the list when it is cut off | Showing 200 of 1,340. Scroll for more, or type to narrow the list. | cut | Under a cut-off list a faint line reads "200 of 1,340". | pattern | `src/renderer/src/resume/copy.ts:13` | unchanged `src/renderer/src/resume/copy.ts:13` | M2 · no scene: needs that session dialog opened (wanted: the Resume session dialog with a list cut off at 200) |
| C161 | foot of the dialog | ↑↓ navigate ⏎ open ⌘⏎ new tab esc close | stays | Stays. the only place that teaches ⌘⏎ opens in a new tab; like the composer's key hint the owner brought back (C3); lean keep \| no picture reached it in either round: today's words stay (was leaning keep) | unseen | `src/renderer/src/resume/copy.ts:15` | unchanged `src/renderer/src/resume/copy.ts:15` | M2 · `m0-resume` |
| C162 | preview on the right: a label before each fact (Folder, Branch, Project, Last active, Last answer, Machine) | Folder | stays | Stays. labels before the facts go, the facts stay; a bare project name under a bare folder path may not read as either \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/resume/copy.ts:16` | unchanged `src/renderer/src/resume/copy.ts:16` | M2 · `m0-resume` |
| C163 | preview on the right: heading over the last few messages | Where you left off | stays | Stays. a heading that splits the preview's facts from its messages; group headings came back elsewhere \| no picture reached it in either round: today's words stay (was leaning cut) | unseen | `src/renderer/src/resume/copy.ts:17` | unchanged `src/renderer/src/resume/copy.ts:17` | M2 · `m0-resume` |

### Start-up repair window (when the background service will not start)

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| C166 | paragraph under the headline (three wordings) | MAWS runs its sessions, terminals and index in a background process, mawsd, and could not load or start it: <why>. If MAWS is turned off in System Settings › General › Login Items & Extensions, under Allow in the Background, turn it on, then come back to this window. | cut | The repair window's paragraph gives the cause and the fix only (e.g. "<why>. If MAWS is off in System Settings › General › Login Items & Extensions, turn it on and come back."); the other kinds are cut the same way. | pattern | `src/renderer/src/repair/copy.ts:33` | unchanged `src/renderer/src/repair/copy.ts:33` | M2 · no scene: needs that session dialog opened (wanted: the start-up repair window (background service will not start)) |
| C168 | left of the buttons while a retry runs | Starting mawsd… | cut | Left of the buttons during a retry it reads "Starting…". | pattern | `src/renderer/src/repair/copy.ts:6` | unchanged `src/renderer/src/repair/copy.ts:6` | M2 · no scene: needs that session dialog opened (wanted: the start-up repair window during a retry) |

## The UX wave's new text (M0)

Rows added by M0 for text the UX wave added after the pin. **Today** here is the text on master `028cecd10`, every row's basis is `pattern` (or `consent` for a consent text), and **Source** is the file and line on master.

### The conversation

#### Session transcript, run of tool calls

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N99 | the line of a call that auto mode blocked, now with "again" and "approved" | Auto mode blocked again: `rm -rf build` · approved | stays | Stays. rule 2: "again" and "approved" are status that confirms something that could have failed (a call blocked a second time, a grant the person sent); the blocked-call subject is the thing the line is about | pattern | `src/renderer/src/transcript/model/copy.ts:142` | new `src/renderer/src/transcript/model/copy.ts:142` | M2 · `m0-auto-blocked` |

#### Session transcript, blocked call

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N100 | the muted line under a call blocked again when no Approve and retry is offered | A rule that always denies this command blocks it every time. Change the rule or the mode to run it. | reword | The line reads "A rule always denies this command. Change the rule or the mode to run it." ("blocks it every time" is said twice; "call" form in the same table shortened the same way). | pattern | `src/renderer/src/transcript/model/copy.ts:175` | new `src/renderer/src/transcript/model/copy.ts:175` | M2 · `m0-auto-blocked` |
| N101 | the other form of the same line, for a call that is not a command | A rule that always denies this call blocks it every time. Change the rule or the mode to run it. | reword | The line reads "A rule always denies this call. Change the rule or the mode to run it." | pattern | `src/renderer/src/transcript/model/copy.ts:176` | new `src/renderer/src/transcript/model/copy.ts:176` | M2 · no scene: the call form is not drawn yet (the code says it is unused until a later landing) |
| N102 | the greyed Approve and retry button; its tooltip carries the reason the button is closed | Approve and retry (greyed; the reason is its tooltip) | stays | Stays. rule 3: a worded button that names its act stays. Its reason lives in a native title on a disabled button, which takes no keyboard focus: per "Every hidden fact has an owner that takes keyboard focus" the button must be aria-disabled and still focusable (build note, not a text change) | pattern | `src/renderer/src/blocked-call/ApproveAndRetry.tsx:22` | new `src/renderer/src/blocked-call/ApproveAndRetry.tsx:22` | M2 · `m0-auto-blocked` |
| N103 | the line under the Approve and retry button after a press the port refused | <the port's refusal sentence> | stays | Stays. rule 5: a refusal keeps its reason; the sentence is the port's own words, so any wording change is that port's row, not this display | pattern | `src/renderer/src/blocked-call/ApproveAndRetry.tsx:25` | new `src/renderer/src/blocked-call/ApproveAndRetry.tsx:25` | M2 · no scene: needs a refused press (the port closed or the session gone); no fixture states that |

#### Session transcript, agents started

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N104 | the agent line when every agent ended with the session process | Explore and Plan ended with the session | stays | Stays. rule 2: the stopped state is the exception worth words (like Stopped and Failed on the turn line), the default "finished" is what T86 cuts; the new form is a status a person must be told because the agents did not finish | pattern | `src/renderer/src/transcript/model/copy.ts:243` | new `src/renderer/src/transcript/model/copy.ts:243` | M2 · no scene: needs a recorded conversation with that event (wanted: a session whose agents were still running when the session process exited) |

#### Session transcript, jump button

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N109 | the pill at the transcript's end while a waiting request is out of view | ◐ Needs your input | reword | The pill reads "◐ Needs you", the sidebar's own words for the same state; the glyph and the accessible name stay. | pattern | `src/renderer/src/transcript/view/Transcript.tsx:938` | new `src/renderer/src/transcript/view/Transcript.tsx:938` | M2 · no scene: needs a recorded conversation with that event (wanted: a session with a request waiting above the visible part of a long transcript) |
| N110 | the tooltip of that pill | Needs your input. Scroll to the request | cut | The pill has no tooltip; its accessible name keeps the sentence. | pattern | `src/renderer/src/transcript/view/Transcript.tsx:934` | new `src/renderer/src/transcript/view/Transcript.tsx:934` | M2 · no scene: needs a recorded conversation with that event (wanted: a session with a request waiting above the visible part of a long transcript) |

#### Session transcript, end of the transcript

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N117 | the row at the end while the session compacts | Compacting session… 12s | reword | The row reads "Compacting… 12s" (the elapsed time stays once it reaches a second). | pattern | `src/renderer/src/transcript/model/copy.ts:346` | new `src/renderer/src/transcript/model/copy.ts:346` | M2 · no scene: a transient wait no fixture holds (wanted: a session while it compacts (the engine reports compacting)) |

#### Session transcript, replayed command

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N118 | a slash command's output line: the mark, and the command's name before output with no bubble of its own | ⎿ /cost · Total cost: $0.01 | stays | Stays. rule 2: names the command the output belongs to when no bubble does; the mark is MAWS's drawing of a light result line (T67 already cut the "Command output" label) | pattern | `src/renderer/src/transcript/model/copy.ts:339` | new `src/renderer/src/transcript/model/copy.ts:339` | M2 · `r2-disk-local` |

#### Session transcript, answer actions

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N119 | the tooltip of Fork from here under an answer | Starts a new session from this point. This one stays as it is. | cut | The Fork from here button has no tooltip sentence; its accessible name stays. | pattern | `src/renderer/src/transcript/model/copy.ts:342` | new `src/renderer/src/transcript/model/copy.ts:342` | M2 · no scene: needs the pointer on a control the rig does not hover (wanted: the pointer on the last answer of a finished turn) |
| N120 | why Fork from here is greyed (the same-machine rule: on another machine, or while the turn runs) | <the reason sentence, as the tooltip of the greyed button> | stays | Stays. rule 5 and the keyboard-owner rule: the reason is kept, but a native disabled button takes no focus, so the button must be drawn aria-disabled and stay focusable so the reason is reachable (build note) | pattern | `src/renderer/src/transcript/view/rows/AnswerActions.tsx:62` | new `src/renderer/src/transcript/view/rows/AnswerActions.tsx:62` | M2 · no scene: only a session on another machine over RL2, or a turn running there, greys Fork |

#### Session transcript, artifact line

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N121 | the line of an artifact an agent deletes: while out and when done | Deleting Q3 plan… / Deleted Q3 plan | stays | Stays. rule 2: a destructive step done by an agent is told in plain words, as "Updated artifact Q3 plan · v4" is (T102); the ellipsis marks the wait | pattern | `src/renderer/src/transcript/model/copy.ts:568` | new `src/renderer/src/transcript/model/copy.ts:568` | M2 · no scene: needs a recorded conversation with that event (wanted: a session in which an agent deleted an artifact, with the artifact line before and after the answer) |
| N122 | the line of a delete that got no answer because the turn closed first | Deleting Q3 plan was never answered | reword | The line reads "No answer to deleting Q3 plan". | pattern | `src/renderer/src/transcript/model/copy.ts:569` | new `src/renderer/src/transcript/model/copy.ts:569` | M2 · no scene: needs a delete whose turn was closed before its result arrived |
| N123 | the line of a refused delete, with its reason | Could not delete Q3 plan: you made it. Delete it from the Library if you no longer need it. | reword | The reasons that carry the Library advice end "Delete it from the Library." (four of the five reasons; the design-system reason keeps its own way out) | pattern | `src/renderer/src/transcript/model/copy.ts:577` | new `src/renderer/src/transcript/model/copy.ts:577` | M2 · no scene: needs a recorded conversation with that event (wanted: a session in which an agent's delete of an artifact was refused) |
| N124 | the sentence after a deleted artifact if Undo fails, and the Undo button | Undo / Not restored: <reason> | stays | Stays. rule 3: a worded way back, rule 5: a failure keeps its reason | pattern | `src/renderer/src/transcript/model/copy.ts:570` | new `src/renderer/src/transcript/model/copy.ts:570` | M2 · no scene: needs a recorded conversation with that event (wanted: a session in which an agent deleted an artifact, with the artifact line before and after the answer) |

#### Session transcript, the agent's prose

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N125 | the tooltip of an artifact mentioned in prose | Opens the artifact · ⌘-click opens it in a tab | reword | The tooltip reads "⌘-click opens it in a tab". | pattern | `src/renderer/src/transcript/view/markdown/Link.tsx:43` | new `src/renderer/src/transcript/view/markdown/Link.tsx:43` | M2 · `r2-disk-artifacts` |

### Approvals, plans and questions

#### Session transcript, questions card

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N105 | the state word on a question or ask row whose every answer was skipped | Dismissed | stays | Stays. rule 3 with the owner's ruling T96: the question card keeps its state words (Answered, Partially answered, Not answered); Dismissed is the same family and says the card closed without answers | pattern | `src/renderer/src/transcript/model/copy.ts:447` | new `src/renderer/src/transcript/model/copy.ts:447` | M2 · no scene: needs a waiting request of that kind (wanted: an ask or question whose every line was dismissed) |
| N106 | the "Open beside" button on an ask capsule whose form stands in the row | Open beside | stays | Stays. rule 3: a button that names where it leads; "beside" is the word the app uses for the right column. Same family as the capsule's Open (T98 reads the answered form) | pattern | `src/renderer/src/transcript/model/copy.ts:450` | new `src/renderer/src/transcript/model/copy.ts:450` | M2 · `session-question` |

#### Session transcript, waiting request

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N107 | the muted word on a question or plan row answered somewhere else (a receipt) | Already answered elsewhere | reword | The receipt reads "Answered elsewhere", the same words the card used. | pattern | `src/renderer/src/stores/attention.ts:98` | new `src/renderer/src/stores/attention.ts:98` | M2 · no scene: needs a request answered from another client between the card opening and the answer going out |
| N108 | the receipt a question or plan row keeps after a terminal or another client answered it first | Answered in the terminal: Allowed / Dismissed in the terminal / No longer asked | stays | Stays. rule 2: who did what to a request; these words are the pin's race words, now also drawn as a transcript receipt | pattern | `src/renderer/src/lane-a/race.ts:43` | new `src/renderer/src/lane-a/race.ts:43` | M2 · no scene: needs a terminal-held session in that state (wanted: a question answered in the terminal first, on a session driven through the sminos bridge) |
| N114 | the heading over the other waiting requests at the end of the transcript | Also waiting | stays | Stays. rule 3: a group heading over lines that are ways in; each line carries its summary and "from <agent>" | pattern | `src/renderer/src/request-card/EndRegion.tsx:53` | new `src/renderer/src/request-card/EndRegion.tsx:53` | M2 · no scene: needs a waiting request of that kind (wanted: two requests waiting at the end of one transcript) |
| N115 | the line that follows a request answered somewhere else, at the end of the transcript | <summary> · Answered in the terminal: Allowed | stays | Stays. rule 2: says how the race ended for the request just seen; it leaves by itself after a few seconds | pattern | `src/renderer/src/request-card/EndRegion.tsx:71` | new `src/renderer/src/request-card/EndRegion.tsx:71` | M2 · no scene: needs a request a terminal answered first, with the sminos bridge |
| N116 | the toast when a request asked for from outside is no longer waiting | That request is no longer waiting | stays | Stays. rule 5: an error keeps its reason; a click that does nothing needs saying. "That request" is short enough; a one-line toast | pattern | `src/renderer/src/request-card/show-waiting.ts:18` | new `src/renderer/src/request-card/show-waiting.ts:18` | M2 · no scene: needs a notification for a request answered before the click |

#### Waiting request, small card from the sidebar or the Overview

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N111 | the heading of the card listing the session's waiting requests, when more than one waits | Waiting for you · 2 | reword | The heading reads "Waiting for you 2" with the number as a bare count whose accessible name says what it counts. | pattern | `src/renderer/src/request-card/WaitingCard.tsx:27` | new `src/renderer/src/request-card/WaitingCard.tsx:27` | M2 · no scene: needs a waiting request of that kind (wanted: two requests waiting in one session at once, with the right column's cards open) |
| N112 | each line of that card: the request's summary, "from <agent>" and its age | Run `npm test` · from Reviewer · 2m | stays | Stays. rule 2: what waits, who asked and its age orient; the full summary is the line's tooltip, a secondary fact | pattern | `src/renderer/src/request-card/WaitingCard.tsx:38` | new `src/renderer/src/request-card/WaitingCard.tsx:38` | M2 · no scene: needs a waiting request of that kind (wanted: two requests waiting in one session at once, with the right column's cards open) |

#### Message box, notices above it

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N113 | the one line above the compact pane's message box counting requests that wait | Waiting for you · 2 | reword | The line reads "Waiting for you 2", a bare count. | pattern | `src/renderer/src/session/SessionPane.tsx:180` | new `src/renderer/src/session/SessionPane.tsx:180` | M2 · no scene: needs a waiting request of that kind (wanted: the floating session card (compact pane) with a request waiting) |

### Message box

#### Queued messages, above the message box

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N126 | the words of a queued answer to an agent's question | Answer to Layout: Two columns / Answers to 2 questions: … | stays | Stays. rule 2: says what a waiting message is (an answer, with its count of questions); the same text the transcript shows for it | pattern | `src/renderer/src/composer/queue/stack.ts:71` | new `src/renderer/src/composer/queue/stack.ts:71` | M2 · no scene: a transient wait no fixture holds (wanted: an answer to the agent's question queued while the turn runs) |

#### Message box, notices above it

| Id | Where | Today | Decision | After | Basis | Source | M0 | Build |
|---|---|---|---|---|---|---|---|---|
| N127 | the warning when a dropped or picked file's path holds a line break | report.pdf can't be attached; its path holds a line break or another control character | reword | The warning reads "report.pdf can't be attached: its path has a line break." | pattern | `src/renderer/src/composer/editor/paste.ts:28` | new `src/renderer/src/composer/editor/paste.ts:28` | M2 · no scene: needs a file whose path holds a line break dropped from the OS |
