## Concise summary for the user (under 400 words)

The strongest import is Codex’s **three-level disclosure hierarchy**: final answer first; a completed-turn work disclosure; inside it, compact activity groups with independently expandable tool details. Tool grouping is semantic and chronological, not “collapse all tool calls.” The active group shows the current tool or Thinking; completed groups become sentences such as “Read files, ran a command.” Denied actions get an explicit count and a jump-to-reason path.

Other high-value patterns are **first-three-files change summaries with Review and Undo/Reapply**, stable subagent identities linked to their conversations, **durable editable message queues**, clear Queue versus Steer versus Stop semantics, a keyboard-operable clarification form, and a virtualized thread that explicitly preserves scroll anchors during disclosure changes.

Two important corrections to the starting assumptions:
- `inline-composer` is a reusable **image-edit prompt** used in image previews—not the user-message editor or a thread reply surface.
- Approvals are not just cards buried in the message log: pending requests can **replace the composer surface**, including named background-subagent approvals. Historical activity and denied-action explanations remain separately inspectable.

For MAWS, import the information hierarchy and interaction semantics, but adapt the engine mappings. Do not copy Codex’s approval modes, auto-review policy, native tool classifications, or raw-output defaults as if they were Claude Code guarantees. Make pending decisions and failed work conspicuous even when ordinary activity is collapsed. Prefer accessible contrast over the benchmark’s very faint metadata.

The newest build also differs materially from standalone Codex: a generalized activity-unit pipeline, more sophisticated combined subagent sentences, typed context search beyond files, and Chat/Work/Codex-specific composer branches. Avoid accidentally importing ChatGPT-only menu items into the workstation.

Remaining verification gaps are clearly marked: exact title-generation trigger/model, full external-editor routing catalog, exhaustive citation rendering, and live feature-flag/default behavior.

# Codex conversation thread and composer — MAWS UX research

## Scope and confidence

Studied the readable sources of ChatGPT/Codex **26.924**, with targeted comparison to standalone Codex **26.623**. This is a reconstruction of shipped implementation, not a claim that every flag-gated branch is enabled for every account. JSX, class lists, state predicates and English copy are recoverable; names are mangled and live defaults are not always inferable. The source README explicitly makes these distinctions. [README:9–13, 60–72]

The MAWS recommendations below are design judgments, not claims about the benchmark. The aim is a Claude Code workstation where the conversation remains readable while implementation work stays inspectable.

### Citation convention

To keep a deeply cited report readable, `C:123–140` means **the absolute file identified by C, lines 123–140**. Every source key below resolves to one file, not a directory. These are file:line references into the readable source.

| Key | Absolute source file |
|---|---|
| README | `/Users/new/codex-app-src/README.md` |
| C | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/conversation-blocks-1768e325fd75.js` |
| AU | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/agent-activity-units-94772c5b3ee6.js` |
| AI | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/agent-activity-item-cc5ea956670d.js` |
| TB | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/timeline-activity-body-34473c494a98.js` |
| CT | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/collapsed-turn-disclosure-74330d6188b4.js` |
| P | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/app-primary-cca0c1a58f0f.js` |
| I | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/app-initial-d817715f10a0.js` |
| S | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/app-shared-36eae88777f2.js` |
| U | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/user-message-b53f167a4396.js` |
| UC | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/collapsible-user-message-content-d5ef21e6496c.js` |
| TS | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/timestamps-85bd12c0e1b2.js` |
| SEP | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/timestamp-separator-f29541cca0ef.js` |
| SL | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/thread-scroll-layout-b0a473da34bb.js` |
| TV | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/thread-virtualizer-e1964ca5c039.js` |
| VL | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/virtualized-turn-list-580e5b0d6228.js` |
| LT | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/local-conversation-thread-8d31f61b9a01.js` |
| MT | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/mcp-tool-item-content-4dd464866122.js` |
| PR | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/pending-request-item-panel-e7a3121b3cbd.js` |
| Q | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/queued-message-list-10ddd40e50db.js` |
| PLAN | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/plan-summary-item-content-c5af6d191504.js` |
| IC | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/inline-composer-33f06c64d6c1.js` |
| IP | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/image-preview-ce2d7e636bb0.js` |
| MATH | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/markdown-1d51173014e4.js` |
| HC | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/highlight-code-7c4c2ef3d4d8.js` |
| FORK | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/threads-fork-911c9b9c61a9.js` |
| REC | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/thread-recovery-notice-927ed6669b3a.js` |
| LOAD | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/thread-loading-status-66c8769e8b6e.js` |
| MENU | `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/thread-overflow-menu-72238cb23898.js` |
| OLD | `/Users/new/codex-app-src/readable/codex-26.623/renderer/app/app-initial~app-main~onboarding-page-CNHnOMz8.js` |
| OLDHOME | `/Users/new/codex-app-src/readable/codex-26.623/renderer/app/app-initial~app-main~automations-page-BcHjEK7e.js` |

## Executive summary — ten things worth importing

1. **Answer-first, work-on-demand.** Completed turns can collapse their work when the final answer starts; the answer is not forced to compete with the execution transcript. Preserve explicit denied-action indicators. **Adapt** to MAWS’s tool/event model. [C:26341–26359; CT:170–210]
2. **Semantic activity summaries rather than tool-name spam.** “Read files, ran a command” is generated from categories and counts, with active/thinking/completed states. **Import the presentation; adapt the classifiers.** [AU:595–648, 1329–1367; C:7964–7986]
3. **Independent group and cell disclosure.** A short summary opens a bounded activity list; a cell can then reveal a shell result, diff or MCP output. **Adapt** with an “open full log” destination to avoid nested-scroll frustration. [C:8038–8219, 25141–25225; MT:2316–2408]
4. **An actionable change receipt.** First three changed files, line counts, Review, Undo/Reapply, and “Show N more files” make the result tangible. **Import**, but use reliable checkpoint/revert semantics, not an assumed Git-only equivalent. [C:20375–20426, 20505–20532, 20625–20703, 21268]
5. **Stable, compact subagent identity.** Seeded glyphs, clickable names, grouped lifecycle sentences, overflow to the full list. **Adapt** to MAWS’s topology panel and agent sessions. [C:6540–6675, 6735–6788, 18733–18779]
6. **Decisions at the input locus.** Pending permission/questions can occupy the composer surface; a child agent is named explicitly. **Adapt**, keeping other ongoing work readable. [P:157557–157670, 186170–186188]
7. **Queue is a first-class durable state, not lost text.** Edit, delete, retry, steer, pause/resume and uncertain-delivery copy are all represented. **Import the semantics.** [Q:185–207, 545–570, 680–705, 825–899, 1230–1245]
8. **A typed-context composer.** Files/folders, images, remote files and app capture are distinct context actions; file search is session-based. **Adapt** the context schema to Claude Code rather than flattening everything into pasted text. [P:179507–179544, 180872–180905; I:491920–492029]
9. **Scroll stability is product behavior.** Explicit anchors, measured turn heights, overscan and disclosure-position preservation protect reading during streaming. **Import as a requirement**, not incidental implementation. [TV:3–92; C:26274–26290; SL:1270–1310]
10. **Rich output is a usable artifact.** Code copying/wrapping, expandable/copyable tables, image previews and file-location chips reduce the need to leave the thread. **Import selectively**, routed into MAWS tabs/right panel. [S:361540–361652, 361829–361877; P:35315–35377, 36110–36164, 42350–42565]

## 1. Turns, messages, time, streaming and scrolling

### User messages

The user surface is right-aligned, `group/user-message flex w-full flex-col items-end justify-end gap-1`. The bubble uses:

`bg-user-message text-user-message min-w-0 max-w-(--user-chat-width) overflow-hidden break-words px-(--thread-content-margin)` plus `rounded-2xl` for an ordinary message. These are semantic colors and variable widths, not enough evidence to declare one universal fixed pixel width. [U:1458–1468, 2030–2034]

Copy, edit and the message timestamp are secondary controls. On pointer devices they reveal on hover or focus-within; the non-hover media branch keeps actions visible. Copy success persists for 1.5 seconds. The edit state replaces the bubble with a rich text editor, “Edit message,” Cancel and Send; its own container is `rounded-3xl bg-text/5 dark:bg-primary-soft`. A failed submit does not clear the edit draft. **Do not infer the exact history-rewrite/fork semantics from this presentational component:** it delegates submission to a callback. [U:876–890, 924–1044, 1292–1299, 1329–1340, 1530–1546, 1941–1972]

Long messages are genuinely collapsible rather than merely clipped. The reusable component defaults to **20 lines**, measures content, and offers Show more/Show less. [UC:21–39, 255–294, 363]

**MAWS verdict — adapt.** Keep a compact user bubble and editable draft, but make resubmission’s history consequence explicit. Keep attachments inspectable alongside text; do not let a tiny bubble conceal a large operational instruction.

### Assistant work and final answer

Streaming assistant content updates from the live `agentMessage` item; the renderer distinguishes final-answer phase and streaming placeholders. Reasoning is a separate item, not text appended indiscriminately to the answer. [C:24171–24225]

Elapsed-work copy has exact states: **Working** below one second; **Working for {time}** after that; **Worked for {time}** on completion; **You stopped after {time}** on user interruption. The completed label is explicitly described as the divider between agent activity and final response. [P:169341–169425]

There is an **outer activity disclosure** as well as individual tool groups. Collapse is allowed only when the final assistant has started, the turn was not cancelled, and there is renderable activity. Default collapse can be overridden by persisted state, forced expansion or a prevention flag. Thus “everything always auto-collapses at completion” would be inaccurate. The outer collapsed row can show duration or previous-message count plus a denied-action count; clicking that count expands and scrolls to the denied activity. [C:26341–26458, 26274–26290, 26654–26666; CT:21–101, 170–210]

### Time separators and scroll behavior

Timestamp separators are not inserted before every turn. The helper uses a one-hour threshold for the first old user turn and assistant→user gaps, and ten minutes for assistant→assistant gaps. Date labels become Today/Yesterday, weekday, then calendar date; hour/minute formatting is localized. Separator layout is centered, normally `py-4`, with `text-sm leading-5 font-normal text-tertiary select-none`; the day receives font-medium. [TS:3–45, 65–101; SEP:93–109, 121–137, 160–172]

“Scroll to bottom” is a dedicated, conditionally visible control above the composer, with working dots when applicable. The scroll container explicitly sets `[overflow-anchor:none]` and the ordinary thread branch uses `flex flex-col-reverse`; this is deliberate application-managed following, not reliance on browser anchoring. [SL:245–283, 1270–1310]

Virtualization is real. The thread imports `virtualized-turn-list`; the layout helper combines measured heights with estimates (fallback 280px), computes overscanned ranges from distance-to-bottom, and adjusts the stored distance when an anchor’s layout changes. Do not assume a constant visible-turn count: overscan is a parameter. [LT:1010–1018, 23260–23266; TV:3–85, 121–124; VL:1035–1048]

**MAWS verdict — import.** Stable reading position, latest-turn following and jump-to-bottom need explicit tests. A user expanding old work must not be dragged back to the stream.

## 2. Tool activity — exact grouping, disclosure and visual hierarchy

### The actual model

This is not simply “one row per tool type” or “one group per turn.” The pipeline converts raw presentation items into **groupable** or **standalone** activity, collects consecutive groupable items, and then renders active or completed units. [AI:1238–1333; AU:474–525]

Verified classification:

- `exec` and `patch` are normally groupable. The special standalone predicate is **declined plus an automatic-review denial**, not every ordinary nonzero shell exit. [AI:1243–1247; P:161600–161606]
- MCP calls are standalone when they are MCP app widgets; ordinary MCP calls group. Dynamic tools can opt into hidden or standalone presentation. Empty-query web searches disappear; nonempty searches group. [AI:1248–1270]
- Assistant/user messages, stream/system errors, subagent activity, multi-agent actions, work-duration rows and images are standalone in this activity pipeline. Approved automatic-review items disappear; in-progress reviews group; aborted/denied/timed-out reviews stand alone. [AI:1272–1317]
- Reasoning, todos, proposed plans, permission requests, turn diffs and user-input prompts return null **from this pipeline**. That does not mean the app lacks those surfaces: they are rendered elsewhere. [AI:1318–1332]

Consecutive groupable items append to one group. A standalone item flushes it. An explicit `startsGroup` marker starts a new group. A `groupAcrossSubagentActivity` option may preserve the grouping connection across a standalone subagent row; its default is false. Stable group keys use item/call/request identity before falling back to source position. [AU:474–544, 1231–1262]

A completed single-item group may unwrap into a standalone cell. It stays a group if active, if its sole patch changes multiple files, or if the patch has visualization activity. The renderer also has explicit preserve-single-group and completed-header exceptions. [AU:1310–1327; C:24753–24770]

### What the collapsed summary says

For the latest open slice of an in-progress turn, the header shows the most recent still-running item, or **Thinking** if none is running. An exploration path can select the latest read/search/list operation. Older units, finished turns and closed slices show their completed summary. [AU:1329–1384]

Completed summary categories have a fixed presentation order: named MCP sources, loaded tools, unnamed MCP calls, file changes, stopped creations, exploration, visualization, ordinary commands, web search, then special tool summaries. Reads/searches/listings share the “Read files” category. Counts often choose singular/plural without being printed. Special command categories are subtracted so they are not double-described as generic commands. [AU:595–648; C:7840–7882, 7930–7986]

The summary’s icon comes from a representative item in its **first summary category**, not an unconditional magnifier. Reads, searches, file listings, shell commands, patches, web and MCP have different icon branches. The prompt’s magnifier example is therefore an instance, not the universal group icon. Summary parts render as an internationalized unit list; fallback is “Worked.” [AU:719–766; C:7683–7747, 25796–25863]

### What expansion does

The group disclosure has states `collapsed → opening → expanded → closing`; content is lazily instantiated when supplied as a function. Height/opacity animate, and collapsed/transitioning content disables pointer interaction. Expansion does not simply dump raw JSON. [C:8038–8136, 8211–8222]

The expanded group is a bounded scroll area:

`vertical-scroll-fade-mask -ms-2 flex max-h-56 flex-col overflow-x-hidden overflow-y-auto ps-2 [--edge-fade-distance:1.5rem]`

This is 14rem maximum height, not an unbounded transcript. It retains individual activity-cell renderers and inserts grouped spacing. Running ordinary search/list cells are filtered from the expanded body until finished; unfinished read cells use a specialized visibility predicate. Empty patches also have a visibility filter. The header can remain informative while the body has less detail. [C:25141–25225, 26101–26117]

Within that expanded list, **consecutive repeated MCP calls** may form a second subgroup, but only if they are groupable, completed, successful, have no explicit source, are not computer-use, have no automatic-review history, and are not a special excluded result. The equality key includes server, tool, function, plugin, connector/link identity, resource URI and the derived display label. A different intervening cell breaks the repetition group. This is not deduplication of arbitrary equal tool names. [AU:1270–1308; C:25197–25223]

### Recoverable visual hierarchy

| Layer | Exact recovered class/behavior |
|---|---|
| Between activity units | `flex flex-col gap-[var(--conversation-item-gap,16px)]` [C:24772–24774] |
| Header hit region | `group/activity-header relative inline-flex min-w-0 max-w-full self-start items-center gap-1 p-0 text-start` [TB:117–133] |
| Summary | `block min-w-0 max-w-full flex-1 truncate text-text/60 [&_*:not(button)]:!text-text/60`; hover promotes to default text [C:25452–25461] |
| Chevron | `icon-2xs shrink-0 text-text/60 opacity-0 … transition-transform duration-relaxed`; revealed by hover/focus, excluding nested file-link hover [TB:19–36] |
| Disclosure body | `-ms-2 ps-2`, animated height/opacity [C:8111–8135] |
| Body rhythm | default `gap-2 pt-2 pb-1`; grouped `gap-[var(--conversation-grouped-item-gap,4px)] pt-1`; optional `ps-6` indentation [TB:436–443] |
| Per-cell muted detail | `text-text/40` / `text-text-tertiary/90`, promoted on hover; file links have independent interaction [C:11054–11057, 11306–11328] |

The hierarchy is primarily typography, spacing and disclosure—not a stack of heavy cards. Full command/diff details introduce surfaces/borders where the content needs them. **MAWS should import this hierarchy but increase metadata contrast where necessary and make the disclosure affordance visible enough to discover without hovering.**

### Individual cells

**Read/search/list:** human descriptions such as “Searched for {query} in {path},” “Listed files in {path},” and “Read {skillName} skill”; file references are independently clickable. Shell-backed exploration retains a route into command detail. Do not imply the default read row displays entire file contents. [C:11575–11833, 12022–12055, 9845–9863, 10885–10925]

**Shell:** full detail includes `$ command`, cwd, output, command-only copy, output-only copy, combined shell copy and expand/collapse. Output uses `max-h-36`, reverse-column following, monospace/preformatted content and edge fades; result footer distinguishes Success, Exit code, unknown and Stopped. Summary timing distinguishes “Running … for {elapsed},” “Ran … in {elapsed},” and “Stopped … after {elapsed}.” [C:10279–10567, 10733–10852, 12359–12365, 12519–12667]

**Web:** the inspected native search cell shows in-progress/completed verb and optional query/URL/find detail, or a supplied title. It is a truncated, shimmering summary row. This component does **not** itself show an expanded SERP dump; citations/results are separate renderers. [C:21492–21601]

**MCP:** rich result blocks when supported; otherwise text/JSON, error surface, or “Tool returned no content.” Common raw/text areas use `max-h-48 overflow-auto`; a separate raw-output dialog is titled “Raw {server}.{tool} tool call output” and allows `max-h-128`. Thus a human-readable result and a forensic escape hatch coexist. [MT:2316–2408, 2709–2727, 3158–3194]

**MAWS verdict — adapt, highest priority.** Build a normalized event→presentation layer over Claude Code’s stream/control events. Preserve raw arguments/results, but default to meaningful labels. Never hide a pending decision in ordinary grouped activity. Keep both outer-turn and inner-tool expansion state stable as streaming updates arrive.

## 3. File changes and end-of-turn review

Inline patch cells distinguish Created file, Deleted file and Edited file, show added/removed counts and expose an accessible **“Toggle diff for {fileName}”** disclosure. Their compact header is `group/activity-header flex items-center justify-between gap-1 text-ellipsis text-size-chat`; file actions and disclosure are separate interactions. [C:16730–16770, 16979–17017, 17098–17116, 17174–17235]

The completed-turn change card is a receipt for work, not another chronological tool event. It shows line totals; on hover the secondary text becomes **Review changes**. Ordinary file clicks route to review/diff for the selected path. Modified Meta/Ctrl clicks take a separate path into file opening with `openInSidePanel: true`. [C:20375–20426, 20463–20485]

The default file-list limit is **three**. Larger lists expose “Show N more files”; the expanded state exposes “Collapse files.” Offscreen file rows may use `content-visibility:auto` with a 36px intrinsic estimate. [C:20625–20703, 21268]

Undo and Reapply exist, with pending disabled/loading states. This is not an “Apply every agent edit” workflow: edits have already happened; the card can revert/reapply them. Failure handling includes partial success, no changes, Git-repository requirement and per-file issues. [C:19360–19519, 20505–20532]

**MAWS verdict — import/adapt.** Use the card as a stable link into the right diff panel or middle diff tab. Bind undo to exact captured edits/checkpoints; label scope explicitly. Avoid presenting “Undo” as universally safe when unrelated user edits now overlap.

## 4. Subagent rows and inter-agent communication

The grouped sentence displays all names up to three agents; above three, it displays the first two names and “N more.” It renders up to four glyphs. Status wording covers started working, updated, interrupted, finished, finished with errors and made progress. Names support Enter/Space activation; overflow has its own button. [C:6548–6581, 6600–6625, 6646–6675]

Glyph components are seeded from agent/conversation identity; they are not evidence that literal flower/asterisk emoji are the underlying data model. The row layout is `flex min-w-0 items-start gap-1.5 text-base leading-5 select-none`; glyph strip `inline-flex h-5 shrink-0 items-center gap-1.5`; individual glyphs use `size-4`. [C:6592–6621, 6735–6758, 18733–18757]

The renderer deduplicates by agent ID and reconciles thread-scoped lifecycle information against background agents. Names that are blank or merely repeat the thread ID can be excluded from grouped named activity. It suppresses redundant completed spawn activity under specific conditions. [C:6871–6911, 6914–7017]

A standalone row’s click calls the supplied subagent-open context with ID and label only if `canOpen` is true. This confirms navigability, but the row itself does not hardcode “open right panel”; MAWS should connect that callback to its planned Subagents panel and selected child. [C:18733–18779]

Message activity explicitly says **“Sent message to parent”** or **“Sent message to {agent}.”** Multi-agent tool detail can also expose instructions/prompts. A symmetric, always-visible “received from” row was not established in this pass; do not invent one from the send labels. [C:18706–18724, 15713–15776]

**MAWS verdict — adapt.** Preserve stable identity across inline row, topology node and child-session tab. Show lifecycle without dumping every child trace into the parent; allow message handoffs to be inspected.

## 5. Inline approvals, permissions and Full access

The strongest finding is **placement**: a pending-request renderer can replace the ordinary composer surface. It accepts the parent pending request and the first background-subagent approval; child requests are given an explicit actor label. This keeps the decision at the bottom interaction locus rather than requiring the user to find the originating tool call. It does not establish that every kind of work continues while one approval waits; that is runtime-dependent. [P:157557–157670, 186170–186205]

Command prompts say **“Allow ChatGPT to run this command?”** or “Do you want {actor} to run this command?” File prompts pluralize the number of files. Network requests name the destination and explain **“{host} isn’t on the current network allowlist.”** More general permission requests distinguish viewing, editing, viewing-and-editing paths and connecting to the internet. [PR:2700–2885, 4760–4818, 5097–5121]

Escalation choices are scoped: **Allow all edits** is described as allowing this and future file edits in this conversation; **Allow similar commands** can mean a specific command prefix for this conversation. The generic approval card offers Allow once, Deny and Allow this conversation. These are materially different grants, not interchangeable “yes” buttons. [PR:5144–5203; P:170830–170841, 170995–171095]

The command preview is bounded: `flex max-h-80 w-full flex-col overflow-hidden rounded-md bg-surface-tertiary text-size-code text-tertiary`, with Expand/Collapse. File-request preview explicitly has “Diff too large to preview.” [PR:2105–2145, 5370–5415]

Registered defaults are **Enter approve; Escape decline**. A safety guard avoids taking Enter away from buttons/links and skips nested dialogs/menus. Do not copy only the keys without the focus/enablement rules. [I:65344–65370; P:170729–170766]

Full access warning: **“ChatGPT can edit any file and run commands with internet access without your approval.”** The warning also names data loss, exposure and unexpected changes, and its dismissal copy specifies 30 days. Newest source additionally contains paid-usage-sensitive auto-review nudges; those policy mechanisms are Codex-specific, not a visual primitive MAWS must inherit. [P:17655–17719; `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/auto-review-approval-nudge-ce82af91954c.js`:153–226]

**MAWS verdict — adapt.** Map choices only to actual Claude Code control-protocol capabilities and configured permission mode. Name the requesting agent, exact operation and grant scope. Keep a persistent pending-decision indicator if the user navigates away.

## 6. Plans, reasoning, questions and task progress

**Reasoning:** the distinct disclosure says Thinking, Thought, or Thought for {elapsed}. Its expanded content is bounded at **8.75rem**, scrolls/fades, and can follow live reasoning. This is disclosure of supplied reasoning summaries, not evidence of access to hidden model reasoning. [C:18083–18117, 18162–18189, 24207–24225]

**Plan artifact:** a plan card has Writing plan/Plan states, summary expansion, download and open/close in side panel actions. An implementation request separately asks **“Implement this plan?”** with **“Yes, implement this plan”** and a Something else alternative. Treat plan artifact, implementation approval and task list as three related but distinct concepts. [PLAN:673–716, 835–850, 940–946; PR:4270–4288, 4510–4520]

**Clarifying questions:** the shared request form supports single-choice radio and multi-choice checkbox presentation, numbered options, descriptions and a Recommended badge. It has previous/next question controls, Skip, Next/Submit/Continue, and free text. Option layout uses a medium text-sm title and a secondary text-sm description; it adapts to container width rather than requiring a fixed desktop width. [P:125000–125055, 125559–125648, 125970–126007, 126299–126305, 126943–126993]

**Task progress:** the compact live pill says **“Step X / Y”** above the composer, with a donut percentage based on completed steps. It chooses the in-progress step, otherwise the first incomplete step, otherwise the last. An immediate interactive tooltip shows the checklist; completed step text becomes tertiary. This is an agent-owned status list, not proof of user-editable todos. [C:18838–18945, 18947–18985]

**MAWS verdict — import/adapt.** Use real structured question events for forms, plain markdown otherwise. Keep plan approval explicit. Connect task progress to the right topology/tasks surface without placing a large checklist between every assistant paragraph.

## 7. Errors, recovery, interrupted work, queueing and steering

Stream failures have reconnect attempt/max-attempt progress. Server overload and a disconnected response with HTTP 429 get **“Server is busy, reconnecting”**, optionally followed by the progress fraction. Other cases can display Reconnecting plus progress or supplied error content. This is a transient recovery row, not necessarily a permanent turn failure. [C:18407–18482]

There is a separate session-level loading/reconnecting component: **“Reconnecting to ChatGPT…”** is visible with spinner above the composer; **“Loading task…”** is screen-reader-only. `ThreadRecoveryNotice` specifically checks nonlocal host and resuming conditions; it suppresses its branch during host connecting/restarting. Do not describe that component as a universal local-session crash-recovery banner. [LOAD:11–55; REC:17–38]

The submit control’s meanings are explicit: **Send** when idle, **Stop** during streaming, **Resume** for interrupted tasks, **Queue** to hold a follow-up until the run finishes, **Steer** to apply it to the active run immediately. Those labels encode different operations; “send while busy” is insufficient. [P:153870–153934]

Queued messages expose edit, delete, retry, steer and—in supported contexts—Open in side chat. Queueing can be turned off/on. An interruption pauses the queue with **“Queue paused because you interrupted”** and Resume. A failed item blocks continuation with **“Retry, edit, or delete it to continue the queue.”** An uncertain delivery says to check the conversation before deleting the saved message, rather than claiming it definitely failed. [Q:185–207, 545–570, 680–705, 730–745, 820–899, 1230–1245]

Sending a new message while a queue is paused can invoke a confirmation asking whether to clear previously queued messages. [P:174381–174410]

**MAWS verdict — import.** Persist queued drafts and attachment references. Distinguish delivery-unconfirmed from failed, stop from steer, and runtime reconnection from replaying a user message. The exact account-level usage-limit variants and every retry path were not exhaustively traced in this pass; do not generalize the HTTP-429 reconnect branch to all rate limits.

## 8. Composer

### Core editor and keys

Codex’s placeholder is **Do anything**; Chat and Work branches instead select Ask ChatGPT / Work with ChatGPT. The newest combined app has multiple composer families, so finding a string in `app-primary` does not prove it is in the Codex menu. [P:94493–94527]

The ProseMirror controller’s default enter behavior is `enter`; it also supports `newline`, `cmdAlways`, and `cmdIfMultiline`. Enter submits in the default mode, with special handling for active suggestions, code/list contexts and composing behavior. Shift-Enter inserts a newline/list-aware break; Mod-Enter has its own submit branch. Separately, the app registers Cmd/Ctrl-Enter for submit-in-background. A screenshot cannot convey these semantics: MAWS should expose the effective keybinding in the submit tooltip. [I:478060–478075, 478235–478350, 65220–65240]

Prompt history is not just browser undo. Unmodified ArrowUp at the end of an empty editor restores the last prompt; further navigation cycles history. ArrowDown past the latest history item restores empty input. Editing a recalled entry invalidates history-navigation position rather than overwriting the edited draft on the next arrow. Global and per-conversation history providers exist. [I:465737–465833; P:116849–116877]

### Plus menu, attachments and context

The verified **Codex** context-action builder supplies:

- Files and folders when file attachments are supported, otherwise Add photos;
- an optional current-application appshot, disabled when there is no capture target;
- Add remote files for a nonlocal execution target with a picker.

These are composable actions used by the context menu, not a universal fixed menu specification. The broader shared menu can include contextual suggestions, plugins and skills. ChatGPT-specific Add library files/Create image/Web search branches should not be blindly counted as Codex defaults. [P:179507–179544, 180872–180950, 186145–186170; P:104183–104254]

Attachment upload and draft state are tracked separately. Large pasted text can become a **Pasted text.txt** attachment with preview, cancellation and stale-draft guards; in the inspected handler, markdown pastes below 5,000 characters are not converted. This does not establish a universal 5,000-character threshold for every paste type. [P:182835–182907]

The attachment flow exposes upload failure/removal states and blocks sending while uploads are pending. For MAWS, the valuable behavior is a visible pending attachment with retry/remove, not silently swallowing paste failures. [P:101660–101715; source strings in P include `composer.submit.waitForFileUploads` and `composer.submit.waitForImageUploads`; exact block-handler paths were not traced here.]

### @ mentions and slash commands

The local file index uses app-server **fuzzyFileSearch/sessionStart**, sessionUpdate, sessionStop, streamed updates/completion and workspace roots. There is a compatibility path to one-shot `fuzzyFileSearch`; this is an implementation detail to avoid copying into a fresh MAWS design unless necessary. User states include Type to search for files, Searching files and result sections. [I:491920–492049, 492470–492490]

The newest @ surface has typed groups beyond files—skills, plugins/apps, agents, chats and browser tabs appear in the indexed string/components. Availability is capability/mode-dependent, not a guarantee that every group appears in each Codex session. [I:492470–492490, 495260–495280; P:101780–102235, 105010–105020, 186145–186169]

Verified slash definitions include Plan, Compact, Fork chat, Init, MCP, Model, Reasoning, Status, New chat and Side; Rename and Pin also exist. The important pattern is commands as searchable structured actions, not a magic prompt prefix. MAWS should surface the Claude Code/SDK-supported commands and client-only actions distinctly. [P:112831–112936, 162360–162380, 162490–162521, 162680–162695, 163008–163020, 163362–163375, 164502–164540, 164765–164780, 165305–165315, 167548–167560, 168506–168518, 174133–174145]

### What inline-composer actually is

`inline-composer` is a generic small form wrapper accepting children, label, submit label, multiline/embedded/generating, submit/cancel and outside-blur handlers. It handles Escape cancellation and Enter submission from a textarea, respecting Shift and IME composition. Its observed callers are image preview/edit surfaces. The image preview labels it **“Describe edits”** / **“Send image edit.”** The user-message edit UI is instead implemented in `user-message`. [IC:38–94; IP:750–780; U:876–1044]

**Verdict — skip as a core conversation primitive; adapt later for image/artifact editing.** Do not design a thread-reply feature based on this chunk’s filename.

### Voice/dictation

The source distinguishes dictation from live voice. Dictation has maximum-recording-length, did-not-catch-that, unavailable-device and text-recovery states. Recovered text can be copied or added to the message, and the user can view the recording/retry. Live voice separately has start/end/mute/transcript controls. [P:93870–93898, 95520–95665, 96255–96330, 99300–99699]

**MAWS verdict — adapt.** Dictation is a useful composer input mode; realtime voice is a larger feature and should not be treated as necessary for the initial workstation.

## 9. Markdown, code, tables, images, links and citations

**Math:** the markdown renderer lazily loads remarkMath and rehype-KaTeX and adds their plugins. **Import** if scientific/technical work is in scope. [MATH:374–392, 513–532]

**Code:** recovered code-snippet controls include language/title, copy, and Enable/Disable word wrap; source/text can stream before highlighting catches up. However, the inspected generic `highlight-code` path registers language grammars through a highlight.js-style core. It is **not justified to call every thread code block “Shiki” merely because Shiki assets exist**. Multiple code renderers coexist in this merged application. Import the UX, not an assumed library choice. [S:361540–361652, 361758–361800, 361829–361877, 362042–362100; HC:1–3 and final language-registration/export block]

**Mermaid:** a separate renderer recognizes Mermaid fences, handles a streaming/loading state and lazy-loads the diagram component. Import with a source fallback and isolation appropriate to generated content. [P:32160–32226, 32285–32302, 32766–32818]

**Tables:** horizontally scrollable table semantics plus Copy table, Expand table and a closeable table preview. This is more useful than simply permitting the thread to overflow horizontally. [P:35840–35850, 36110–36164, 36305–36372]

**Images:** loading/unavailable states, alt/fallback labels, open-image-preview action and multi-image grid handling are represented. The image viewer is also an edit entry point. [P:34975–35002, 35315–35377, 36425–36448; IP:750–780]

**File links:** file-reference chips preserve path, cwd/host and line/column ranges, resolve an opening target and expose keyboard activation. They have explicit busy/disabled state, not merely an unvalidated `file://` URL. Single, modified and auxiliary clicks have different routing hooks. The exact editor catalog under `renderer/apps` and full external-URL default routing were not exhaustively traced, so this report does not claim one universal “all links open externally” rule. [P:30120–30195, 30489–30574]

**Citations:** file citations can encode page, slide, sheet/object and code-line locations; memory citations have a summary and tooltip list; MCP citations can resolve a tool-backed view and show unavailable-connection errors. These are multiple citation types, not one uniform footnote style. [P:42350–42565; C:2106–2241, 6040–6128]

**MAWS verdict — import/adapt.** Distinguish external URLs, workspace file locations, generated artifacts and citations at the renderer boundary. Ordinary click should go to MAWS’s appropriate file/artifact surface; explicit “open in editor/browser” remains available. Keep copying markdown/source possible when preview rendering fails.

## 10. Forks, recovery and titles

Fork supports **same directory** and **new worktree**. Same-directory fork carries source history, cwd/workspace roots and collaboration mode, then synchronizes state. A worktree fork is asynchronous and initially has no child thread ID. A fork can retain an interrupted active turn; creating it is not equivalent to automatically continuing work. [FORK:29–66, 68–111, 128–131]

A thread can display **“Continued from chat”** as a clickable provenance divider. Composer commands distinguish fork in the current/same worktree versus new isolated worktree. **Import provenance; adapt environment choices** to MAWS’s session/project model. [C:12929–12956; P:162490–162525]

Recovery is as described in §7: `ThreadRecoveryNotice` is narrower than its filename suggests. Import robust recovery state, not the assumption that a banner means the engine has safely resumed. [REC:17–38]

Rename is available from the thread overflow and `/rename`; the dialog says **Rename chat**, **Keep it short and recognizable**, and **Add a title…**. The source also subscribes to `thread/name/updated`, confirming title updates arrive through the app-server. The **exact automatic title-generation trigger, model and fallback sequence are not established** by this pass and should not be invented. [MENU:149–164, 1095–1120; P:112924–112936; I:344725–344744, 394850–394865]

**MAWS verdict — import/adapt.** Preserve fork lineage and user naming. Treat generated titles as replaceable suggestions; do not let generation overwrite an explicit rename.

## Material differences from standalone 26.623

- **Not new in September:** Do anything and elapsed Working/Worked dividers already existed in standalone. They are durable Codex patterns, not an effect of the ChatGPT merger. [OLDHOME:31935–31945; OLD:224580–224615]
- **Activity architecture/palette changed:** standalone has an explicit `collapsed-tool-activity` render branch and `text-token-conversation-summary-leading/trailing` classes. Newest factors activity into the dedicated item/units/body modules and uses `text-text/60`, `text-text/40`, etc. Do not transplant old token names or infer identical collapse rules. [OLD:284810–284833, 285850–285910; AI:1238–1333; C:25452–25461]
- **Subagent copy is more coherent/localizable:** standalone builds statuses such as “started working”/“finished” separately after chips; newest has a complete count/status sentence including overflow names and failure/progress branches. [OLD:268878–268906, 268938–268981; C:6671–6675]
- **Merged-app caveat:** newest composer has explicit Chat/Work/Codex placeholder and capability branches. ChatGPT image/web/library actions found nearby are not evidence of an identical Codex plus menu. [P:94493–94527, 104183–104254, 179507–179544]

## Recommended MAWS implementation order

1. Normalize runtime events into user message, assistant commentary/final, tool activity, decision request, subagent lifecycle, artifact/change receipt and error/recovery.
2. Implement scroll anchoring and stable identity alongside the thread—not after UI polish.
3. Build the compact activity group/cell/detail hierarchy, with denial/error discoverability.
4. Add end-turn changed-file receipts and routed review.
5. Add durable queued drafts, explicit steer/stop and structured request forms.
6. Add rich context composition and artifact rendering incrementally.

These are recommendations for MAWS, not a prescription to reproduce Codex’s engine or policy. The largest avoidable mistake is copying the visible collapsed row without the lifecycle, focus, persistence and failure semantics that make it trustworthy.

### Outstanding validation, explicitly not claimed complete

- Live flag/default behavior, interaction timing and exact contrast at the user’s font/theme settings.
- Precise message-edit history rewrite/fork effects beyond the presentation callback.
- Automatic title-generation trigger/model and every account-level rate-limit/retry variant.
- Full external editor/browser routing catalog and exhaustive citations.
- Whether every typed @ group is enabled in a given Codex workspace.