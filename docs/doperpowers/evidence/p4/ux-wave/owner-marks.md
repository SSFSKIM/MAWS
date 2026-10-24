# The owner's marks on the UX comparison

The owner's marks on the review page's findings (`MAWS-notes/ux-comparison-2026-10-23/review/`), recorded verbatim in the batches they arrive in. The finding texts live outside the repo; the wave's ledger cites them by id. Observations sent with a batch go to `ux-directions.md`.

## Batch 1 (2026-10-23, about 23:55Z; lens 1 and part of lens 2)

```
l1-sessions-01 fix — sure, fix and in proposed way is good.
l1-sessions-02 dismiss — This is fine. Claude Code CLI even mark session with background job idle. That's not crucial gap. If main is idle the session can be marked idle
l1-sessions-03 fix — This is good proposal. Searching with conversation body can be good.
l1-sessions-05 fix — I've said that we're removing "Need You" part, but never mind, we'll keep it, but make it a bit smaller. currently it holds too much space. Though, as much as functionality, not adding unncessary complexity is important.
l1-sessions-04 fix
l1-sessions-06 dismiss — This is Fine. I'd rather say that we shrink 'need you' part that we already have to take less space. human only need to know which session they have to visit.
l1-sessions-07 fix — sure, but Medium Impact.
l1-sessions-09 fix — Adopt Codex's Method: '+' on project lets user choose from existing project under ~/.claude, or choose directory from finder. App auto discovers the projects, but don't put all of them on the sidebar. user can choose to remove projects from sidebar or add project on sidebar, choose new directory as project, and so on. clear?
l1-sessions-08 fix — good idea. Medium agreed.
l1-sessions-11 dismiss — Not needed. Non-necessary tool. Doperpower's plugin 'sminos' allows agents to see communicate and coordinate with other sessions already, which is enough. No more actions needed.
l1-sessions-10 option a — yes this is what I'd say 'inefficient use of space' -- if a session is in worktree, sidebar only need to mark that it is in worktree, no need to name which branch. What we can do instead is make widget that appears when mouse hovered and shows more information there -- branch name can show up on hovered card. Make sidebar compact. I think branch mark can go at the left part of the session card, and show the V icon on the right. switch two's position. still keep how long session is, but add hovering, and add three dots too (on Claude Desktop, hovering on the session component shows three dots that has options like change title, fork, and more)
l1-sessions-13 fix — accepted proposals.
l1-sessions-12 fix
l2-transcript-03 fix — I'm going to say this is quite a bad defect. It should render as agent produce. If the "Message" we done is what's causing problem we can remove that. (As I know the default mod behavior is just color orange on <message> tagged messages, not a box with message. our transcript rendering has to be like Claude Desktop's -- structured exactly in a way agent produced. no
l2-transcript-15 fix — non closed tag for (3) is fine. that's just mod's fault not ours. Proposal accepted, and make it like Claude's.
l2-transcript-01 fix — [/Users/new/Pictures/Screenshots/tool-use-shoot.png,
/Users/new/Pictures/Screenshots/tool-use-shot-2.png] is how I want our tool use to be shown too -- not like Codex Desktop's but like Claude Code Desktop's block-style, and summary to represent each tool calls instead of raw commands (this, we'll need to figure out how the app gets tools use's one line summary. this happens on Claude CLI too, so CLI source might have one). Things like Skill can be shown as "Ran
/skill", "used ~MCP". and agreed proposal's mechanism.
/Users/new/Documents/tool-input-output.png is how tool call input and output is rendered, which I think works better. only optionally human sees what agent actually ran what agents actually executed, and Claude Desktop's way is a good way to display it. Same for the way of showing edits.
l2-transcript-02 fix — agreed with proposal.
```
