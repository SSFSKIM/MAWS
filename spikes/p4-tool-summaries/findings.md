# Spike: tool-use summaries, reasoning summaries and edit rows (2026-10-24)

The owner asked whether MAWS's transcript can label agent work the way Claude Desktop's Code mode does, and stream a reasoning summary while the model thinks, without changing engine behaviour (D-1). They added that file edits and writes should be ordinary tool rows with +N −M counts and an inline diff, and that MAWS's end-of-turn "files changed / Undo" card is not wanted.

The owner confirmed that their reference screenshot (`MAWS-notes/ux-comparison-2026-10-23/owner-notes/claude-tool-group-summaries-2026-10-24.png`) is Claude Desktop's Code mode.

- Researched by an astra agent; this document was written by the architect from its hand-back.
- Probes ran the untouched engine 2.1.309, with total spend $0.0536.
- Fixtures:
  - `spikes/protocol-probe/fixtures/p4/p4-tool-summaries-live.jsonl` (Haiku 5.5; three dependent reads, two user turns);
  - `spikes/protocol-probe/fixtures/p4/p4-tool-summaries-thinking-edits.jsonl` (Opus 5.5; Edit, Write, then a summarized-thinking turn).
- Scenarios are beside them under `spikes/protocol-probe/scenarios/p4/`.
- Desktop citations are to `/Users/new/claude-desktop-re/readable/app-3.6556.2/`. Engine citations are to `/Users/new/claude-code-bundle/2.1.309/cli.pretty.js`.

## 1. Where Code's labels come from

Code labels rows locally, from the tool calls themselves. There is no summarizer call.

- **Bash and PowerShell:** the row is the agent's own `input.description`, inflected into running and done forms by a local tense helper (`web/app/v1/c52b02f3f-BejopSz8.js:4497-4543`; the tense conversion is at :896). A second shared shell renderer also prefers the description to `Ran <command>` (`cc1aae219-CeSwM-tp.js:56785-56865`). "Read existing memo for consistency" is therefore most likely a Bash description. The older expanded screenshot (`owner-notes/claude-tool-input-output.png`) shows such a row opening onto a Bash command.
- **Read:** the row is "Read" plus the file's basename (`c52b02f3f-BejopSz8.js:4545-4561`).
- **Skill:** the row is the localized "Ran skill" plus `/<skill>` (`c52b02f3f-BejopSz8.js:4705-4725`). In Korean that string is "Skill 실행됨" (`web/i18n/static/ko-KR.json:32697`), which is why those rows are Korean while the descriptions are English.
- **Agent and Task:** the row is the agent's `input.description`, with running and done labels (`c52b02f3f-BejopSz8.js:4672-4704`).
- **Group headers** ("Edited 2 files, created 1 file, ran 1 command" and its +/− totals) are deterministic localized categories (`c24951e9f-JzS5EfmT.js:535-648`). Grouping and Write classification are at :939-1013, and the totals at `c96d752d0-CWv_7-n9.js:104224-104237`.
- **Code turns the engine's summaries off:** it launches the engine with `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: "false"` (`main-process/index.chunk-jPKPzV-P.js:316009`).
- **Cowork turns them on**, behind a gate (`main-process/index.chunk-Dl8NPgw7.js:20511`). The shared renderer can show such summaries (`ccba96ec3-BOycIJQ9.js:644-657, 938-952`) and can use thinking summaries for group status (`c05b96c7f-MPVkefMW.js:10307-10372`).

## 2. The engine's `tool_use_summary`

- **Switch:** the environment variable `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=true` turns it on (read at cli.pretty.js:471290-471292). It is a supported engine option, not a patch. No public CLI flag for it was found.
- **What it summarizes:** one helper request per tool batch of a model-loop iteration, made after the batch's tools finish. It is not made per tool, and not for a subagent's own batches (:473102-473122).
- **Helper input** (:468836-468887): the tool names, each input and output truncated to 300 characters, the last assistant text capped at 200 characters, and earlier tool names. The prompt asks for a past-tense label of about 30 characters, in commit-subject style.
- **Model and cost:** the helper uses the engine's small-fast route, normally Haiku, with fallbacks (:694500-694525, :823535-823584). It has no tools, no thinking and no prompt caching. That is one small billed call per qualifying batch. No flat per-row price can be quoted.
- **Timing:** the helper starts in the background and is awaited after the following model response (:472831-472835). Each label therefore arrives one response late. In the live fixture, the summaries for the first and second reads arrive at seq 44 and 63, both before the final answer at seq 69. The summary for the third read follows the final answer, at seq 73. UX1-C's "only after the final answer" came from a one-tool turn and does not hold in general.
- **Batches with several tools:** one summary covers Edit and Write together, "Updated index status, wrote notes" (Opus fixture :97).
- **What MAWS does with it today:** it parses the frame (`src/shared/wire/frames.ts:397-403`) and normalizes it with its full id list (`src/engine-host/normalizer.ts:226-230`). It then attaches the label to the batch's last id only (`src/renderer/src/transcript/model/derive.ts:578-584`), where it replaces that row's title and hides its counts (`transcript/view/cells/CellLine.tsx:16-31`). A build should treat the id list as the batch and keep each row's own facts.

## 3. Reasoning summaries

- **From the API documentation** (platform.claude.com, build-with-claude/thinking, fetched 2026-10-24):
  - Readable thinking is always a summary, written by a separate model server-side; it is never raw chain of thought.
  - `display: "summarized"` returns the summary. `"omitted"` returns empty text.
  - Billing is for the full thinking tokens under either display, so a summary adds no billed tokens. The latency it adds is small.
  - On Opus 5.5, Sonnet 5.5 and Fable 5.1, `display: "updates"` hides the reasoning and streams summaries of the model's progress notes between tools. A progress note is not reasoning, and the model may not write one.
  - Empty thinking with a signature is not `redacted_thinking`. Neither can be turned into a summary.
- **What the engine does:**
  - It defaults eligible routes to progress updates (`CLAUDE_CODE_THINKING_DISPLAY_UPDATES ?? true`, :686348-686364; the request side is at :692605-692631).
  - A live session switches to reasoning summaries with the control request `{subtype: "set_max_thinking_tokens", max_thinking_tokens: null, thinking_display: "summarized"}` (:438750-438766).
  - The hidden CLI enum takes summarized, omitted or highlights; it has no `updates` value (:913755-913758).
- **Wire evidence:**
  - **Opus 5.5 progress update:** `p4-r7-loss-stages.jsonl:126` reads "Stage 2 restored 34 of the 37 missing labels…".
  - **Opus 5.5 reasoning summary:** after the control request (Opus fixture :100-101), `thinking_delta` streams at :110-150 with `thinking_display: "summarized"` and completes at :153.
  - **Sonnet 5.5 and Haiku 5.5:** recorded with empty signed thinking (`pass3/hooks-flipped.jsonl:42`; live fixture :106).
  - **Fable 5.1:** unverified on this engine route.
  - **Simple turns:** some produce no thinking at all (the Opus edit turn).
- **A MAWS defect:** MAWS sends this request with a `display` field (`src/shared/wire/control.ts:141`, `src/engine-host/ipc.ts:511`), but the engine reads `thinking_display`. Any display toggle MAWS offers today has no effect.
- **What MAWS's renderer does today:**
  - It already streams `thinking_delta` (`normalizer.ts:282-296`) and shows a generic live "Thinking" label with the text on disclosure (`transcript/view/rows/Thinking.tsx:1-35`). Completed empty blocks disappear (`derive.ts:421-425`).
  - It does not carry `thinking_display` into the normalized event. The UI needs that field to tell a progress note from a reasoning summary.

## 4. Edit and write rows; the files-changed card

- **Desktop's counts and diffs** are computed locally from the tool data (`c254f7f8c-BfWrXYyi.js`):
  - it validates `toolUseResult.structuredPatch` hunks (:23-53) and binds each patch to the matching file and input (:74-102);
  - it counts the + and − lines (:155-170);
  - it builds a fallback diff from Edit or Write inputs (:171-350);
  - it aggregates per path, excluding errors (:503-537).
  - The inline row renders a line-numbered diff, or a view of pure additions (`cb6930dae-Dw_4c1QI.js:8013-8055`).
- **What the unmodified engine gives MAWS:**
  - a successful Edit's result frame carries `tool_use_result` with `filePath`, `oldString`, `newString`, `originalFile` and `structuredPatch` (Opus fixture :61, one line changed, +1 −1);
  - a Write that creates a file carries `type: "create"`, the content, an empty `structuredPatch` and `originalFile: null` (:80). It should still read +1 −0, as a pure addition.
- **MAWS already has most of this:**
  - it keeps that sidecar as `tool.result.structured` (`normalizer.ts:350-365`);
  - it derives counts and hunks (`transcript/model/cells.ts:119-157`);
  - it renders a line-numbered inline diff (`transcript/view/cells/EditDetail.tsx:15-103`).
- **Two gaps:**
  - The fallback `text.split('\n').length` counts a trailing newline as a line, so a one-line create reads +2.
  - An empty patch renders "no diff" instead of the created content.
- **The card and its Undo:**
  - Today derive emits the receipt for any turn that changed files (`derive.ts:877-882`), and `transcript/view/rows/Receipt.tsx` renders it.
  - Its Undo is the engine's file checkpoint rewind for that turn: `session.rewindFiles`, run as a dry run first (`transcript/source/ipc.ts:495-516`), which reaches `rewind_files` (`src/engine-host/rewind.ts:51-63`). There is no forward reapply.
  - Removing the card does not have to remove that capability. Where, if anywhere, a "restore files to before this turn" action lives is a product choice.

## Sketch: the first turn of the Opus fixture

```
Read 1 file, edited 1 file, created 1 file                 +2 −1
  Read index.txt
  Edited index.txt                                         +1 −1
  Created notes.txt                                        +1 −0
```

The model's own commentary stays in its place in time, between Read and Edit.
- **Expanding a row:** Edited shows the path and the replaced line 2; Created shows the one added line.
- **With engine summaries on:** the caption "Updated index status, wrote notes" (fixture :97) can sit over the Edit and Write pair, and the per-file rows stay.
- **Live line while thinking:** it shows the streamed progress or summary text, such as "Stage 2 restored 34 of the 37 missing labels…".

## Recommendation

1. **Free and factual first.** Label rows from the Bash, Agent and Task descriptions, Skill names, the tool verb with its target, and MCP identity. Group headers are counted locally. Edit and Write rows show their counts and expand to an inline diff. None of this costs a model call.
2. **Engine batch summaries, as an option.** They become a caption for a group whose rows lack descriptions, keyed to the whole id set. They are never a replacement for the rows. Each costs one small helper call per batch and arrives one response late.
3. **Thinking line.** It streams the visible progress or summary text, bounded and with disclosure. Showing reasoning summaries rather than progress notes means sending `thinking_display: "summarized"`, which adds no billed tokens. First fix MAWS's `display` field so that the request takes effect.
4. **Remove the files-changed card** as the owner asked. Keep the checkpoint rewind behind a deliberate action if the owner wants it.

The owner decides:
- whether to turn on the engine's batch summaries;
- whether the thinking line shows reasoning summaries or only progress notes;
- where, if anywhere, "restore files to before this turn" lives once the card is gone.
