# P4-A3 — The edit protocol (2026-10-21)

> **Parent:** `docs/doperpowers/plans/2026-10-19-p4-smoothing.md` (the P4 composite spec), child **P4-A3**, §5 "P4-A3 — The edit protocol — plan, conditional on A1"; §2 item 11 and the owner's ruling of Decision Log 17 ("따라잡아야 종료"); dispatched by Decision Log 54 at P4-A1's record landing. Parent pin: blob `e8dcab899cfb0c7d0db61e41644d4e2014b71a01` at master `7c5248920`. Root spec `docs/charter.md`. Binding here: §4.2's decision rule (MAWS's median send-to-edit-landed above 1.2 times Desktop's means Desktop is faster, no middle band), Decision Log 8 (no effort adjustment; MAWS's own tool speed is what matters), X33 (the `maws` server's descriptions change only by a dated line), D-1 (the engine unmodified).
>
> Executor branch: `p4-a3` (worktree `.claude/worktrees/agent-a2d2077edd6d1ab4c`), off origin/master at 7c5248920. The architect lands to master and writes the ledgers, the tracker, the charter and the spec from the hand-back. This document is the child's own record.

## Purpose

P4-A1's parity bench timed four edits from send to edit landed in a fresh session, MAWS against Claude Desktop, five reps a cell (`spikes/p4-parity-bench/findings.txt` §7c). B1, B5 and B7 came out at parity. On B3, the paragraph rewrite, Desktop was faster: MAWS 32.5 s against 25.6 s, a ratio of 1.273. Under the owner's ruling, P4 closes only when MAWS's median on B3 is within 1.2 times Desktop's, re-measured on A1's harness, by levers that make MAWS faster for the owner. Changing the measure, the model or the effort does not count.

What A1's breakdown left to explain: both arms make three requests to the landing with equal first-byte waits, and MAWS's tool time is 35 ms. The gap is generation: 25.2 s against 15.8 s, with 2712 thinking tokens against 1287, before MAWS's single edit. One lever in A3's family moves the number by itself: every `maws` tool is deferred behind ToolSearch under MAWS's launch, so the first edit pays one ToolSearch request (2.9 s at the median).

## Progress

- [x] 2026-10-21 13:00Z Grounding. The record's requests rebuilt exactly from the transcripts' `api-request-shape` and `-blob` records: MAWS's B3 edit request is 31,102 input tokens, the same as recorded.
- [x] 2026-10-21 13:05 to 14:20Z The thinking gap, by replay: 191 replays of the recorded B3 edit request through the owner's relay, one component swapped at a time (§ The thinking gap). Spend US$13.74.
- [x] 2026-10-21 13:50Z Lever 1, `alwaysLoad`, written and tested (e7b08e90f). B4's probe re-recorded on the pinned 2.1.304 against the stub, nothing spent.
- [x] 2026-10-21 13:50Z The harness: lever arms, the breakdown to the landing, the bootstrap, and A1's three residue items (8be429f2c).
- [x] 2026-10-21 Lever 2, the linked read, approved by the architect (Decision Log 5), built with its tests and its probe (`p4-a3-linked-read`, nothing spent).
- [x] 2026-10-21 20:39 to 21:10Z Window (a) on the mini: the three arms built from p4-a3-arms, then B3 base, alwaysLoad and attach x10 each, and B1, B5 and B7 on attach x5 each; every repetition valid (§ Results).
- [x] 2026-10-21 21:12 to 21:30Z Window (b) on the mini: B3, Desktop's Code tab against MAWS on both levers, n of 11 each, interleaved: parity, 0.756 (§ Results).
- [ ] Merge master, class 1a on the merge, the Mac groups, hand-back.

## The residue decided here

1. **Which tools are always loaded.** The tools an edit needs, read from A1's record. Documents make `artifact_read` then `artifact_edit`. Decks make `artifact_read`, `artifact_describe_type` and `artifact_publish`, and pay two ToolSearch requests today. So these four carry `_meta["anthropic/alwaysLoad"]`, beside P4-R7's `message`. `artifact_create` and the comment, asset, export, search and dataset tools still defer: a session that is handed an artifact to edit needs none of them first.
2. **The cost.** Measured with count_tokens on the tools as listed: 2,943 tokens on every request of every MAWS session. By tool: edit 1,436, publish 647, read 604, describe_type 256. The four names leave the deferred list, which saves about 40 tokens. The definitions sit in the tools prefix, so they are cached across requests and across sessions. The change of prefix costs one cache write per prefix, then cache reads (about US$0.0006 a request at the engine's Opus 5.5 rates as A1 fitted them). A session that edits artifacts loads these definitions anyway. Loading them up front breaks no cache mid-session.
3. **How a lever's arm is measured.** Each arm is its own build. The base checkout is the harness alone (8be429f2c, product code identical to master); the lever checkout adds the lever (e7b08e90f). One queue runner interleaves both: each request names its checkout. A manifest records the lever's label and the checkout's commit. parse.py makes each label its own cell (`maws/<label>`), and gives no verdict until the judged one is named (`--maws B3=alwaysLoad`), as `--judge` does for Desktop's surfaces.
4. **A1's residue, as far as A3 needs it.** These are tracker rows of 2026-10-21:
   - The requested-model difference is named beside the verdict, never voiding it.
   - `bench.probe({save})` writes its report, the recent rows and the whole tree under the run's `ax/`.
   - The Claude tab's recent rows are read as 3.1623.0 shows them: a button, with a menu button for the same title beside it.
5. **Lever 2, the linked read (Decision Log 5).**
   - Trigger: a human message whose words carry a `maws-artifact:` link, in any form X33's grammar allows (`#v<n>`, `#tab=`, `#block=`, `#slide=`).
   - When: as the queue submits the message, before the entry becomes `submitting`, with the queue busy meanwhile. A pause, an exit or a removal while the reads are taken leaves the entry queued with nothing written, as a paused queue holds an entry. A steer (a message sent while a turn runs, Send now, an ask's answer) goes as written, without reads: its write must stay ordered with a stop's hold (Decision Log 6).
   - Content: the session's own `artifact_read` answer, whole, revision included, read as the message is submitted (so it is the artifact at send time). It is called through the server's registered definition with no tool-use id, so it resolves, migrates and answers exactly as the agent's read would. A link naming a tab reads that tab. A version link still reads the live artifact, the one an edit acts on.
   - Form: one text block per read after the human's words in the same user message (`src/shared/maws/linked-read.ts`). A `<system-reminder>`, one line naming the artifact by its link, then the read's JSON. The replay validated this form: with it the model called `artifact_edit` directly in 6 of 6 replays.
   - Cap: 24,000 UTF-8 bytes over all the reads as sent. A token is at least one byte, so the reads cost at most 24,000 tokens however token-dense the artifact (hex, Hangul, minified html), and about a quarter of that for English prose. That holds the bench's document (about 8,000 bytes) and deck (about 4,000) and a working document of some 3,500 words, and stays under the 25,000 tokens the engine allows one tool result, the most a read the agent made itself could cost. Links attach in link order, each once. A read refused, or larger than what the cap has left, is not attached, and the agent reads it as it would have. A later, smaller one still goes.
   - A read not attached leaves no trace: what it changed in the session's memory of the artifact (an html page's byte base, a file kind's replica base, which a publish merges from) is put back, so the agent's next publish is judged as if that read had not happened. A document's read also records its view, which only validates an edit from that revision. The agent learns a revision only from a read it does see, so that record is left.
   - Staleness: the read carries its revision, so an edit from a read gone stale is refused by the edit's existing `baseRevision` check (the scripted session test shows it).
   - What the human sees: the queue keeps and shows the human's message. The transcript draws each read as a chip ("<title>, read at revision N"), never as text. The recent-turns preview and the rename suggestion read the human's words alone.
   - The guides: no line added. The model edits from the attached read unprompted (the replay), so X33's descriptions are unchanged.
6. **What the report adds beside the rule, never changing it:**
   - The breakdown to the landing (requests, first byte, generation, hold, thinking and output tokens, over the requests up to the one that made the landing call).
   - The send to the turn's last landing.
   - The ratio's seeded bootstrap interval: 20,000 resamples within each arm. On A1's B3 it reproduces the hand-computed figures: 0.794 to 1.928, with 66 % of resamples above 1.2.

## The thinking gap

**Method.** The B3 edit request (MAWS's request 2 of maws-B3-r3; Desktop's of desktop-B3-r1, its long draft) is rebuilt from the records and sent again through the owner's relay, n times, with one component swapped. A cache breakpoint on the last user message keeps the n replays cheap; caching does not change what the model generates. Thinking tokens come from `usage.output_tokens_details.thinking_tokens`. The scripts and the per-call results (`results.jsonl`, one compact row a call; `summ.py results.jsonl` prints the table) are in `spikes/p4-parity-bench/a3-replay/`. The first wave's file variant named a path outside the session's working directory; the model went looking for the file instead of editing, so those eight are kept as `flowD_outside_cwd` and not counted.

**Results.** Median thinking tokens, with n:

| Variant | What is swapped | n | Thinking, median | Words of the rewrite |
|---|---|---|---|---|
| asis | MAWS's request as recorded | 19 | 2723 | 131 to 142 |
| desk | Desktop's request as recorded | 18 | 1187 | 132 to 158 |
| sysD | MAWS with Desktop's system prompt | 8 | 3151 | 131 to 139 |
| D_sysM | Desktop with MAWS's system prompt | 10 | 718 | 139 to 154 |
| D_flowM | Desktop's context, MAWS's turn (artifact_read's JSON, then artifact_edit) | 10 | 2477 | 132 to 141 |
| flowD | MAWS's context, the document as a file (Read, then Edit) | 18 | 1545 | 131 to 145 |
| readplain | the read's result as plain markdown, not JSON | 8 | 2464 | 131 to 141 |
| editshort | artifact_edit's description cut to its ops | 8 | 3008 | 135 to 146 |
| count | artifact_edit's result promising each replaced block's word count | 18 | 2869 | 128 to 146 |
| readcount | the read giving each block's word count | 10 | 2539 | 132 to 138 |
| readcount_count | both | 10 | 2752 | 128 to 137 |
| no1m | MAWS without the 1M variant (no context-1m beta, the plain environment line) | 10 | 3087 | 125 to 140 |
| D_1m | Desktop with the 1M variant | 10 | 1127 | 136 to 152 |
| master | master's prompt since the record (supplement 2, the message tool) | 8 | 1919 | 133 to 139 |
| attached | the linked artifact's read attached to the message; read and edit loaded | 6 | 2388 | 137 to 149 |

**Why.** A diagnostic run of each request with thinking display "summarized" shows what the model reasons about:
- On the artifact it drafts, counts the words and trims toward the original's length before its single replace_block ("I'm trimming word by word … working toward that 127-word target"). It also weighs replace_block against replace_text.
- With a file it usually writes "Now I'll check the word count against the original and make the exact replacement". It lands a long draft, then measures with `wc` and trims in further edits (A1's record: four of five).

**Finding.**
- Ruled out: the system prompt, the guides' wording (the edit description), the read result's form, the context around the turn, the 1M variant, and a promised or given word count.
- What moves the thinking is the edit path. With a file the model can measure the length with a tool after landing; with an artifact it cannot, so it measures in its thinking first.
- That is a property of the task (a length constraint) meeting the artifact's edit path. It is none of the request diet, the context diet or the guides.
- The one way to move it would be to have MAWS's model land a draft first and trim after. That wins the first-landing measure while the owner gets the final text later: on A1's record, Desktop reached its last landing after MAWS (0.84). So it is not built. It goes to the architect as `[parent-impact]`, with a proposed tracker row.

## Plan of Work

1. The harness (done, 8be429f2c).
2. Lever 1, `alwaysLoad` (done, e7b08e90f).
3. Window (a), quiet, no GUI, 100 minutes:
   - The two checkouts built under `/tmp/maws-parity-bench/a3/`, then one shakedown repetition each.
   - B3 base x8 against alwaysLoad x8, interleaved in pairs, the pair's first arm alternating.
   - B1, B5 and B7 on the lever, x5 each, reported beside the record's cells as a check that nothing regressed (the architect's ruling).
4. Window (b), GUI and quiet, 70 minutes:
   - `bench.probe({save})`.
   - B3 Desktop Code x11 against MAWS on the final levers x11, interleaved, the round's first arm alternating.
   - The verdict by parse.py's rule unchanged.
5. Gates: class 1a on the pool. The Mac groups the change reaches (the tool list's e2e groups), at the architect's go.
6. Review with doperpowers:reviewer-medium over 7c5248920..head, then the hand-back.

## Results

The record is `spikes/p4-parity-bench/record-a3-2026-10-21/`: run-a, run-b and shakedown, each with its manifests, measured rows and report.json, plus the run log. The transcripts stay on the mini, under `/tmp/maws-parity-bench/a3/run-*/transcripts/`, as the owner's records.

The arms are built from `p4-a3-arms` off 7c5248920:
- base 7e8dd275d: the harness, with the product as on master.
- alwaysLoad 646970a54: base plus lever 1.
- attach 80e89dd23: base plus levers 1 and 2; its tree is p4-a3 at e81638d7e.

Every MAWS repetition checked that the app was built from its arm's commit.

Controls, recorded and none voiding:
- The mini's engine 2.1.306 for MAWS. Desktop 3.1623.1 as running (its Info.plist read 3.1623.0 at 20:41Z and 3.1623.1 at 21:31Z), on its engine 2.1.304.
- The served model claude-opus-5-5 at xhigh, adaptive thinking, in both arms. MAWS requests the 1M variant and Desktop the plain one, and Desktop has its advisor model.
- MAWS through the gateway, Desktop direct.
- Auto mode in every repetition.
- The network: the mini has been on Wi-Fi (en1, ResNet) since its reboot at 16:48Z, while A1's record ran wired. Anything compared against A1's record crosses that change.
- CI-opt's reads at 20:38:28Z: console user new and not locked, input source ABC, Terminal in front, no Electron, cua Engine, SecurityAgent, UNC, Chrome for Testing, TextEdit or `claude auth` process, Screen Sharing 0, display 2560x1440@2x with no remote and no computer use, load 1.96, memory 80 % free.
- An idle `claude -r` (pid 28318) in a tmux session since 16:56Z, which predates the holds and was left alone.
- The 1-minute load before a repetition: a median of 2.5 to 4.0 per cell.
- Desktop's own usage meter read 87 % of the session limit at the start and 90 % at the end, with "weekly limit nearly reached" showing. It was not reached.

**(a), B3 by arm** (n=10 each, all valid). Medians; the breakdown is over the requests up to the landing.

| Arm | Landed s [min..max] | Requests to the landing | First byte s | Generation s | Hold s | Thinking tokens | Context at the first request | Turn end s |
|---|---|---|---|---|---|---|---|---|
| base | 34.7 [23.3..41.0] | 3 | 4.06 | 26.8 | 0.61 | 2792 | 26,408 | 41.0 |
| alwaysLoad | 27.5 [19.5..39.0] | 2 | 1.56 | 25.1 | 0.72 | 2854 | 29,293 | 31.4 |
| attach | 21.3 [19.6..39.5] | 1 | 0.82 | 19.8 | 0.41 | 2307 | 32,111 | 25.0 |

Each lever moved the breakdown as predicted:
- alwaysLoad removed the ToolSearch request, with its first byte and generation, and added 2,885 tokens to the first request's context (2,943 from count_tokens, less the four names taken out of the deferred list).
- attach removed the read request too, so the first request is the edit, and added the read, about 2,800 tokens.
- The landing moved by 7.2 s for alwaysLoad and a further 6.2 s for attach.
- Thinking stayed where the replays put it.

**(a), B1, B5 and B7 on attach** (n=5 each, all valid), checked against A1's record (wired, a day earlier; MAWS, then Desktop):
- B1 5.4 s against 7.4 and 8.4.
- B5 5.8 s against 11.3 and 16.4.
- B7 13.1 s against 13.7 and 14.4.

Each makes one request fewer to the landing than base would, and B5 and B7 make two fewer. Nothing regressed. These are not verdicts (the architect's ruling).

**(b), B3, the re-measure** (n=11 each, interleaved, the round's first arm alternating, every repetition valid), verdict by parse.py's rule unchanged:

| Arm | Landed s, median [q1..q3] (min..max) | Requests to the landing | First byte s | Generation s | Thinking tokens | Output tokens | Context at the first request | Last landing s | Turn end s |
|---|---|---|---|---|---|---|---|---|---|
| MAWS (attach) | 19.05 [16.19..20.47] (14.13..28.66) | 1 | 0.87 | 16.8 | 1771 | 2146 | 32,107 | 19.05 | 23.3 |
| Desktop Code | 25.19 [23.87..31.10] (12.95..37.21) | 3 | 6.46 | 15.3 | 1249 | 2444 | 63,405 | 34.45 | 45.0 |

The result:
- **Parity: MAWS/Desktop 0.756**, with a 95 % bootstrap interval of 0.53 to 0.835 and 0 % of resamples above 1.2.
- To the turn's last landing, MAWS is at 0.553, and to the turn's end at 0.517.
- MAWS's thinking still runs above Desktop's on its one request; the levers removed the requests around it.
- The engine host attaches the reads before it writes the frame, which happens before the engine's send record, so that time is outside the measure. It is the read tool's own time, about 20 ms (A1's artifact_read spans); the journal does not separate it.

**Spend.** MAWS by the engine's cost state:
- (a) US$11.70 (base B3 US$3.13, alwaysLoad B3 US$2.83, attach B3 US$2.58, B1, B5 and B7 US$3.17).
- The shakedowns US$0.37.
- (b) US$2.59.

Desktop's 11 Code repetitions are quota on the owner's plan, and their API equivalent is not computed here. The replays cost US$13.74.

**What the runs made in the owner's account:** 11 Code sessions in Desktop's "MAWS parity bench" folder, all titled by Desktop "Warmer introduction in doc.md". Nothing was deleted (Decision Log 62: the bench items stay). Each repetition also left a backup copy of doc.md that Desktop's model made in /tmp on the mini, such as /tmp/doc.md.orig-c0e66f25.

**What changed in the driver against the live tree (21:12Z):**
- The Code tab's New now reads "버튼 새로 만들기".
- The folder pop-up has no "Description:" while no folder is chosen.

Both were patched in the hold and are fixed in the driver with their lines in driver_labels_test.mjs. `bench.probe({save})` could not write under /tmp/maws-parity-bench: the cua agent got EPERM there, so a residue row.

## Review

Round 1, doperpowers:reviewer-medium over 7c5248920..b96347122: incorrect, with one P1 and five P2s. All six were real and are fixed (b87dab600, 058b8b22e):
- P1, the stop race. The read's await sat between a steer's registration and its write, so a stop's hold could find a steer the engine had not received and its interrupt be followed by the message. Fixed: reads are taken before a submission is written, the queue busy and a pause honoured, and steers are never prepared (Decision Log 6).
- P2, an unattached read changed the session's publish base. Fixed: it is put back, and a test fails without the fix.
- P2, three bytes a token undercounted token-dense text. Fixed: a byte cap, a true bound.
- P2, `--maws` did not win over a single cell. Fixed.
- P2, `build` was the checkout, not the running app. Fixed: the app's own stamp, and a variant refuses to run on a mismatch.
- P2, the last landing took the last call made, not the latest landing. Fixed.

Round 2, the same reviewer over the fixes (b96347122..da5859ac6): the six fixes close their findings; the preparation's lifecycle had three new P2s, all real, fixed (see the commit after da5859ac6):
- A head removed while being prepared left the next message queued in an idle, unpaused queue. Fixed: the next head goes.
- A preparation ending after an exit saved the queue again, recreating a deleted state or overwriting a relaunch's. Fixed: nothing is saved there.
- A read attached and then discarded (the entry edited meanwhile, or paused) kept its effect on the session's memory. Fixed: a preparation is settled by whether its content reached the pipe, and an attached read is undone when it did not.

Round 3, the same reviewer over da5859ac6..a88b5ea82: the removal and the post-exit save are closed. Two P2 interleavings were left in the undo, both real, both fixed:
- The settle re-read the entry after the write, which an edit's failed save had changed meanwhile. Fixed: it is decided before the write.
- An agent call beside the linked read (a background agent's, the main turn idle) could set the same memory, which the undo then cleared. Fixed: nothing is undone when a call ran beside the read.

Round 4, the last one for lever 2 (the architect's rule), over a88b5ea82..6c2fc5077: round 3's two fixes close their findings. One P2 was left: keeping an unseen read beside a call could put a whole-file base under a view the agent held only in part (a read of some paths). A publish could then overwrite a user's change without force. That is a correctness problem on the link-and-send path, so it is fixed (160cb5419). Beside a call, the memory of that artifact is cleared instead of kept, and the next publish of it is refused as never read. The reviewer's reproduction passes in both its cases. What remains is the cost, a residue row: in that overlap the agent reads the artifact once more before it publishes.

## Surprises & Discoveries

- The transcripts carry the whole request. Since engine 2.1.300 the `api-request-shape` (system and tools) and `api-request-blob` records (messages) let a request be rebuilt to the token. Assistant messages and tool results are not blobbed and come from the transcript's own records. This is what made the replay diagnosis possible without a run.
- Since A1's checkout (1eaac0fe5), master has added R7 (supplement 2 and the always-loaded message tool), R7y's SessionStart alias and R8's MCP servers. So the record's MAWS numbers are not master's. Window (a)'s base arm re-measures master before the lever is attributed.

## Decision Log

1. 2026-10-21 (executor). The four tools an edit needs are always loaded (residue 1). `artifact_create` is left deferred: an edit never needs it first.
2. 2026-10-21 (executor). The thinking gap is diagnosed by replaying the recorded request rather than by e2e arms. A replay isolates the request's content from every other source of variance, and costs about US$0.07 a call against about US$0.35 for an e2e repetition. Levers still land with their e2e arm.
3. 2026-10-21 (executor). No thinking lever is built. The cause is the edit path's lack of a measuring tool. The only lever that moves it games the first-landing measure.
4. 2026-10-21 (architect, relayed). Driving the owner's Claude Desktop with cua on the mini is inside the brief for a granted GUI hold; the brief's "No GUI automation" covers the MacBook and anything outside a granted hold. B1, B5 and B7 are run on the lever only, x5 each, as a regression check, with no Desktop rerun.
5. 2026-10-21 (architect, relayed; the owner may overturn it). The linked read, proposed by the executor as `[parent-impact]`, is approved as a request-diet lever. It removes one request from the owner's real path (link an artifact, ask for an edit), as Claude Code attaches an @-mentioned file. The terms are the architect's: the trigger, the read whole with its revision, a justified cap, the chip in the transcript, a probe fixture, the unit tests, and a reviewer-medium review before it runs. It becomes (a)'s third arm if reviewed before the go, else (b)'s MAWS arm. The alwaysLoad cost (2,943 cached tokens a request) is accepted.
6. 2026-10-21 (executor, at review round 1). Linked reads go with submissions only. A steer's frame is written as it is: it is registered as pending before its write, and a stop's hold withdraws pending steers by uuid, so an await between the two lets a frame follow the stop's interrupt. Holding a steer through its reads would need a held-steer path of its own in the queue. A steer that links an artifact goes without its read, and the agent reads the artifact as before (a residue row). The bench's path, and the owner's usual one (link an artifact and ask), is a submission.

## Outcomes & Retrospective

B3, the one task A1 judged Desktop faster on, is at parity on A1's harness: 0.756, against the record's 1.273. P4's close criterion under Decision Log 17 is met for it.

Two levers did it. Both make MAWS faster for the owner on their real path, link an artifact and ask, rather than changing the measure:
- the edit tools always loaded;
- the linked artifact's read sent with the message.

The thinking gap is a property of the model's strategy on an artifact it cannot measure with a tool. It stays, and is recorded as a tracker row. Four review rounds took the linked read's lifecycle through the stop, the edit, the exit and the publish base. What they left is in the residue rows.
