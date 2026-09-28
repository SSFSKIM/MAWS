## Concise summary for the user (under 400 words)

Codex’s strongest contribution to MAWS is **operational visibility without turning the app into a full IDE**: an attention-aware project/session sidebar, a compact summary of the current task, and independently opened tools for deeper inspection.

The most valuable imports are the pinned summary, Active/Done subagent list with drill-in, branch/diff/PR overview, terminal worktree-mismatch warning, actionable worktree-setup recovery, searchable command menu, and consistent accessible dialogs.

Three important corrections emerged from the sources:

- Codex’s central tabs are **Chat plus content belonging to that task**, not several independent conversations. MAWS’s browser-like multi-session tabs are an intentional extension beyond this benchmark.
- The two small panel-layout buttons control **bottom-panel visibility and right-panel visibility**. Panel maximization and full/split workspace layout are separate operations.
- Several suggested chunk names are misleading in the latest build: `progress-sidebar` is account data transfer, `thread-preview` is shared-chat preview, and `sidebar-actions` contains Sources feedback. The actual sidebar is largely in the huge `app-initial` chunk.

Adapt the composer controls to Claude Code’s real model, workspace and effective permissions; do not reproduce Codex-specific cloud environments, automatic approval review, billing, or sharing without corresponding MAWS capabilities. Keep “files sent to the user,” project files, and information Sources distinct.

The report distinguishes the June standalone shell from September’s combined ChatGPT shell, includes dimensions and state transitions, and documents all 21 animations in the older main stylesheet. That count does not describe the current app’s entire animation system. Findings are source-backed, not live-app verified.

---

# Codex desktop shell UX study for MAWS

## Scope, evidence and citation convention

This study covers the shell, navigation, task context, auxiliary tools and secondary management surfaces—not the conversation transcript. The benchmark is the newest **ChatGPT 26.924.22138**, with **Codex 26.623.141536**, the last standalone build, used for material comparisons. Build identity and extraction limitations are documented in `/Users/new/codex-app-src/README.md:9–13,60–72`.

This is **static, readable-source inspection**, not a live interaction test. JSX, classes, string IDs and handlers are recoverable; mangled names, feature flags, capability branches and generated stubs mean a code path does not prove every account currently sees that control. Recommendations are MAWS design judgments, not claims about an implemented MAWS application.

To keep citations readable, the following prefixes identify absolute source directories. Every citation supplies a filename and literal source line range:

- **N-app**: `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/app/`
- **S-app**: `/Users/new/codex-app-src/readable/codex-26.623/renderer/app/`
- **N-main**: `/Users/new/codex-app-src/readable/chatgpt-26.924/main-process/`
- **S-main**: `/Users/new/codex-app-src/readable/codex-26.623/main-process/`
- **N-CSS**: `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/css/app-shared-fa3f1d5d5942.css`
- **N-shell-CSS**: `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/css/app-initial-5ba553174940.css`
- **S-CSS**: `/Users/new/codex-app-src/readable/codex-26.623/renderer/css/app-jOJotR-N.css`

For example, `N-app app-initial-d817715f10a0.js:44378–44404` identifies that file in the absolute N-app directory, not the older similarly named bundle.

## Executive summary: eleven things worth importing

1. **Make the sidebar an attention queue as well as a history list.** Distinguish unread, awaiting approval and needs input; offer an attention-prioritized ordering. This is especially valuable when MAWS runs several sessions concurrently. **Adapt**, preserving project-first organization. [N-app `app-initial-d817715f10a0.js:323646–323669,351051–351111`]
2. **Use a compact task summary as the resting auxiliary surface.** A branch/change row, PR, subagents and sources give situational awareness without opening a large tool. For MAWS, make this the intentional fallback when the right tool area is closed. **Adapt**, not a literal reproduction of all Codex summary variants. [N-app `local-conversation-thread-8d31f61b9a01.js:13260–13325,13438–13446,4234–4378,16834–16839`; `local-conversation-page-620b0d289994.js:4886–4976`]
3. **Separate panel visibility, panel maximization and workspace arrangement.** These are different actions. Keep the terminal available below the task without requiring it to replace the right inspector. **Import the distinction; adapt the controls and labels.** [N-app `thread-app-shell-chrome-a984dd5a9408.js:637–711,850–872,1169–1285`; `app-initial-d817715f10a0.js:129459–129527,66195–66206`]
4. **Persist panel dimensions, but design narrow-window behavior explicitly.** Codex has real minimums and independent bottom/right sizing, not three perpetually visible fixed columns. **Import the mechanism**, choose MAWS’s exact dimensions after testing its own content. [N-app `app-initial-d817715f10a0.js:42901–43034,44378–44404,136074–136175`]
5. **Start subagent monitoring with a useful list, not only a topology graph.** Active/Done sections, waiting status, elapsed time and a drill-in transcript are immediately legible. **Adapt** the list as the default; topology can be a complementary MAWS view. [N-app `local-conversation-subagents-panel-tab-31c7c9525185.js:206–285,304–320,418–436,478–563`]
6. **Make the git summary a doorway into review.** A lightweight branch/diff row leads into filters, file navigation, staging and reversion. **Adapt** to MAWS’s source-control and diff tools while preserving the summary-to-detail progression. [N-app `worktree-creation-row-9375558be66e.js:23–95`; `thread-side-panel-tab-content-cd4029ad62b3.js:1500–1586,3689–3827,6796–6980,7430–7486`]
7. **Treat worktree creation as a recoverable workflow.** Show phases, expose logs when requested, and offer concrete recovery paths instead of one indefinite spinner. **Import the interaction model**, mapped to MAWS-owned setup operations. [N-app `local-conversation-thread-8d31f61b9a01.js:24760–25090,25555–25589,25945–26089`]
8. **Expose execution context near the composer.** Project, location, starting branch, model/effort and permissions should be inspectable independently. **Adapt** all semantics to Claude Code; never merely repaint a Codex permission selector. [N-app `composer-utility-bar-c4d6c9bca0c5.js:7383–7410,7690–7820,8410–8472`; `permissions-mode-dropdown-d9457bb8a063.js:270–330,1530–1745`]
9. **Preserve terminal identity when task environments change.** Codex warns when an existing terminal belongs to a different worktree and offers a new terminal rather than silently pretending it moved. **Import as a behavioral requirement.** [N-app `terminal-tab-a9323a4c5e98.js:376–424`]
10. **Use one command system and accessible modal grammar.** Searchable actions, context filtering, focus restoration, bounded scrolling and unsaved-change guards compound across the whole app. **Import the behaviors; simplify the implementation.** [N-app `command-menu-dialog-7ada12c7b127.js:718–809,916–1108,1330–1479`; `dialog-shell-e621c590b54e.js:19–36,145–281`; `modal-shell-2810dd204fc4.js:55–275`]
11. **Separate outputs, project files and sources.** The summary distinguishes generated/recent outputs from information used by the task, while the filesystem/editor is a separate tool. MAWS should make “files the agent sent to me” an explicit collection, not infer it from every file touched. **Adapt this information architecture.** [N-app `local-conversation-thread-8d31f61b9a01.js:3674–3814,16715–16722,16834–16839`; `base-file-tree-c9d6d05c9833.js:248–373`]

## 1. App shell, native window, navigation and keyboard

### Native window

Both examined builds default primary windows to **1280×820**, restore saved bounds, and permit a **480×600** minimum. The macOS primary frame uses `titleBarStyle: "hiddenInset"`; `vibrancy: "menu"` is conditional on the surface not being opaque. Primary traffic lights use x=16 and y=round((46×zoom−14)/2), yielding (16,16) at 100% zoom. The newer build has primary `acceptFirstMouse`; detached windows use 44px rather than 46px traffic-light alignment. Windows/Linux use hidden titlebar/overlay configuration rather than macOS vibrancy. [S-main `main-8XtuV7fZ.js:97340–97360,97637–97655,98116–98128,98612–98627`; N-main `main-C5425b_s.js:109489,240327–240352,240868–240975,241523–241537,242077–242135`]

**MAWS verdict — adapt.** Use the native-frame pattern and coordinate drag regions, toolbar height and traffic-light clearance. Do not treat the precise opacity/vibrancy branches as necessary product requirements. A 480px minimum does not mean MAWS’s full three-column layout can remain visible at that width.

### Logical panels and dimensions

The standalone shell explicitly composes a left sidebar, main viewport, right panel and bottom panel; width-measuring logic coordinates competing panes using 960/720px thresholds. Its sidebar default is **300px**, clamped **240–520px**. [S-app `app-initial~app-main~onboarding-page-CNHnOMz8.js:54070–54094,191889–192018,192081–192157,192425–192428`]

The newer sidebar defaults to **340px**, persists `sidebar-width`, and clamps to a 240px floor, 520px ceiling and available width minus 240px. Its resize separator exposes ARIA values and keyboard handling. The root also compensates for zoom and titlebar safe regions. [N-app `app-initial-d817715f10a0.js:44378–44404,47156–47280,128705–128745,128845–128957`]

The newer right/content panel has a nominal **320px minimum**. Maximum width reserves 352px of main content in regular mode or 320px in unified mode; full mode uses the available width. The computed default incorporates shell height×1.6, a 500px main-content reserve and a preferred 640px panel width before clamping. It persists a normalized ratio under `app-shell:right-panel-width:v3`. A separate chat/content workspace divider also has a 320px minimum. [N-app `app-initial-d817715f10a0.js:42901–43034,150880–150923`]

The bottom panel defaults to **280px**. Its height is `max(160px, min(requested height, available main height×0.5))`; dragging below 160px closes the panel. Available main height excludes the 46px toolbar, and resizing the window reclamps it. At extremely small available heights, the 160px floor wins over the half-height cap. [N-app `app-initial-d817715f10a0.js:136074–136175,151670–151680,152766–152777`]

Do not blindly transplant a CSS breakpoint: newer CSS contains a below-768px sidebar rule gated by `data-responsive-sidebar`, but an observed root sets that attribute false. It is not evidence of an unconditional 768px collapse across the app. [N-shell-CSS:412–465,543–564; N-app `app-initial-d817715f10a0.js:128787–128798`]

**MAWS verdict — import pane persistence and accessible resizing; adapt the collapse policy.** Model sidebar, central workspace, right auxiliary area and optional bottom terminal as separately controlled regions. Define what closes first when space is insufficient.

### What the tabs actually mean

The newest task tab model creates **one `thread-chat` entry** and a list of `kind: "content"` entries from that task’s content controller. Tool descriptions say a new content tab belongs to the calling thread unless another thread is explicitly targeted. This is not an implementation of several unrelated conversation tabs in one central browser strip. [N-app `app-initial-d817715f10a0.js:67377–67415,256310`; `/Users/new/codex-app-src/readable/chatgpt-26.924/ui-strings.json:345192–345239,345426–345449`]

The standalone build likewise places content tabs in the current task’s right/bottom regions. Both builds distinguish “Next tab” from “Next chat,” and “Open side chat” from “Open in new window.” [S-app `app-initial~app-main~onboarding-page-CNHnOMz8.js:191889–191984,192105–192153`; `/Users/new/codex-app-src/readable/codex-26.623/ui-strings.json:5189–5205,5253–5275`; `/Users/new/codex-app-src/readable/chatgpt-26.924/ui-strings.json:49062–49078,49118–49142`]

Navigation between tasks is therefore a separate operation from changing content tabs: sidebar selection, chat-navigation commands and separate task windows/side chats are the relevant shell paths. The local sidebar row dispatches navigation and renders independently active state. [N-app `app-initial-d817715f10a0.js:351282–351317,351478–351534`]

**MAWS verdict — adapt deliberately.** MAWS’s browser-like center tabs for multiple sessions and files are a real extension, not a faithful Codex clone. Keep each session’s auxiliary tab state scoped to that session so switching central sessions does not silently retarget terminals or reviews.

### Keyboard map and quick window

Representative **Electron defaults**, subject to feature/context availability and user remapping:

| Action | Default binding | Source |
|---|---|---|
| Command menu | Cmd/Ctrl+K; Cmd/Ctrl+Shift+P | N-app `app-initial-d817715f10a0.js:64700–64715` |
| New task | Cmd/Ctrl+N; Cmd/Ctrl+Shift+O | same file:64842–64864 |
| Search files / file tree | Cmd/Ctrl+P / Cmd/Ctrl+Shift+E | same file:64718–64755 |
| Next task needing attention | Cmd/Ctrl+Alt+A | same file:65542–65555 |
| Toggle sidebar / bottom panel | Cmd/Ctrl+B / Cmd/Ctrl+J | same file:66077–66116 |
| Terminal | Control+backtick | same file:66129–66143 |
| Step workspace layout | Cmd/Ctrl+Shift+B | same file:66195–66206 |
| Model picker | Ctrl+Shift+M | same file:65109–65120 |
| Project picker | Cmd/Ctrl+Alt+Shift+O | same file:65142–65153 |
| Dictation | Ctrl+Shift+D | same file:65191–65204 |
| Settings / shortcuts | Cmd/Ctrl+, / Cmd/Ctrl+/ | same file:65934–66013 |

Next/previous tab, next/previous chat, and recent-chat commands coexist with platform/context-dependent bindings; do not flatten that registry into conflicting global listeners. [N-app `app-initial-d817715f10a0.js:65559–65735`]

The **hotkey window is not the command menu**. It has its own home, new-thread, local-thread and remote-task routes. Its home deliberately hides the ordinary utility bar, presenting a focused composer plus a settings popover with Project, Start in and conditional Environment/Branch/Permissions rows. Detail chrome offers Start New Chat and Open in Main Window. The inspected home JSX does not contain a recent-thread list. [N-app `app-initial-d817715f10a0.js:393080–393091`; `hotkey-window-home-page-28b601b06c37.js:1470–1715`; `hotkey-window-detail-layout-97c557acd363.js:190–255`]

**Verdict — import a shared command registry; adapt defaults.** Defer a separate global quick-capture window until the main window’s composer and session lifecycle are solid.

## 2. Sidebar, projects, rows and home

### Organization and ordering

Newest organization options include **By project**, **By connection**, and **In one list**. Sort choices include **Priority**, **Last updated**, **Created**, and **Manual order**. Priority is explained as “Needs input and unread chats first.” Pinned threads have their own ordering menu and priority explanation. [N-app `app-initial-d817715f10a0.js:323605–323669,376941–376964`]

The main content includes Pinned, Recents and Projects, with collapse state and status summaries. Project sections are collapsible; the folder toggle has explicit Expand/Collapse folder labels and `ariaExpanded`, and animates its chevron. The newer unified shell additionally carries Chat/Work filtering and custom sections—features belonging to the combined product rather than necessary agent-workstation primitives. [N-app `app-initial-d817715f10a0.js:369448–369533,370384–370897,375680–375764,379108–379495`]

The standalone variant exposes **Organize sidebar → By project / By connection / Recent projects / Chronological list**, plus manual, created and last-updated ordering. Its section affordances include hover-revealed new-chat controls. [S-app `app-initial~app-main~automations-page-BcHjEK7e.js:21764–22069,25832–26045`]

**Verdict — adapt.** Default MAWS to projects→sessions, with pinned sessions and a first-class attention view. Keep optional manual ordering. Skip combined-product Chat/Work categories unless MAWS develops genuinely different execution modes.

### Project rows and “+” actions

A project row offers **“Start new chat in {folder}”**; a missing/moved directory yields explicit explanatory copy instead of silently launching in a different folder. Remote connections have their own loading/reconnect disabled states. Project actions include edit, pin/unpin, mark all read, archive chats, remove project, and platform-specific Reveal/Open in file manager. [N-app `app-initial-d817715f10a0.js:372420–372495,373350–373398,373953–374004`]

At section level, separate affordances exist for **Add new project** and **New chat**. Project groups use compact list geometry (`flex flex-col gap-px`), truncate labels, and can reserve a trailing metadata region up to 60% of the row; connection/folder icons can change presentation on hover. [N-app `app-initial-d817715f10a0.js:372700,373055–373089,374269–374290,376626–376639`]

**Verdict — import the differentiated actions.** A project “+” should create a session in that project; the sidebar-level project “+” should add a project. Preserve usable accessible labels and disabled-state reasons rather than relying on icon position.

### Thread rows: state, hover and interaction

The local task row carries active state, status indicators, environment identity, unread state, title, secondary content, metadata and hover actions. It registers click, context menu, double-click and file-drop handlers. “Awaiting approval” is distinct from “Needs input”; needs-input can also carry a deadline/progress/snooze state when automatic resolution is enabled. [N-app `app-initial-d817715f10a0.js:351051–351111,351240–351267,351478–351534`]

The inspected hover card contains title, status, unread blue dot, relative timestamp and project/environment details; its width is `min(20rem, calc(100vw - 16px))`, with a 14rem minimum. This is evidence for timestamps in the hover-detail surface, not proof every row variant always shows the same timestamp inline. Secondary row text can be two-line clamped, small tertiary text, or hover-animated text depending on variant. [N-app `app-initial-d817715f10a0.js:342652–342766,343099–343131,350125–350390,350588–350589,338604–338625`]

Project hover detail reports active, total/partial task, unread and waiting counts, and exposes pin/reconnect actions. [N-app `app-initial-d817715f10a0.js:341329–341376`]

**Verdict — import state distinctions; adapt density.** The persistent row should answer “which task needs me?” before it answers “when was this updated?” Put richer environment/status history in hover or a preview, but ensure actions reveal on keyboard focus as well as hover. Do not make color the sole attention signal.

### Archive, search and drag/drop

The task context actions include Copy, Archive, Pin/Unpin, Project, Rename, Section and mark-read/unread. Bulk/project archive confirmation explicitly warns that ongoing work stops; a scheduled-task variant also says future runs will stop and that chats can be restored later. Errors and partial failures have separate outcomes. [N-app `app-initial-d817715f10a0.js:342118–342252,230269–230433,231003–231086`]

Archive has its own searchable page, type/project filters, unarchive action, loading/error/no-match/empty states. The main sidebar Search entry is separate from that archive search. [N-app `app-initial-d817715f10a0.js:312943–313326,317161–317167,317792–317900,324273–324274`]

Drag/drop is not cosmetic: sortable project groups and conversation-drop callbacks support movement/pinning; dropping into Pinned can set pinned state and preserve insertion order. Project moves may present **“Add folders to {projectName}?”**, explaining that all chats in that project will gain access to those folders. [N-app `app-initial-d817715f10a0.js:373320–373344,379595,379915–380075,352537–352641`]

**Verdict — adapt.** Import drag-to-order/pin and recoverable archive, but make MAWS’s semantics explicit: hide a session, stop a running process, delete a worktree and remove a project are different operations. Surface any change to directory access before committing a project move.

### Fork, recovery and misleading chunk names

Forking supports the same directory or a new worktree. The worktree path creates a queued pending task and carries the original project assignment; the same-directory path returns the created thread and synchronization status. [N-app `threads-fork-911c9b9c61a9.js:29–111`]

`thread-recovery-notice` is narrowly scoped: its inspected branch shows loading for a remote thread resuming, excluding the host’s connecting/restarting state. It is not a universal local-session recovery banner. [N-app `thread-recovery-notice-927ed6669b3a.js:17–47`]

Do not navigate these newest sources solely by filename:

- `thread-preview` renders **shared-chat/image/response previews**, with a 1200:630 aspect ratio, minimum 14rem height and noninteractive/inert content—not the sidebar task hover card. [N-app `thread-preview-f95911f43c73.js:32–55,88–106`]
- `sidebar-actions` contains **Relevant / Not relevant** feedback for Sources, not the principal sidebar task menu. [N-app `sidebar-actions-831d1d0c9ad0.js:89–136,225`]
- `worktree-creation-row` is the compact summary’s worktree/change row. [N-app `worktree-creation-row-9375558be66e.js:23–95,187–258`]

**Verdict — adapt fork/recovery; do not import filename-derived assumptions.** MAWS should distinguish restoring an existing session from creating a fork and avoid duplicate forks after partial setup.

### Projects index and home

The projects index is a compact searchable table/list: name and updated columns, expandable project chats, pin actions, project edit/archive/remove, and new-chat actions. The grid is `minmax(0,1fr) 4rem 8rem`; below **680px** it drops the 4rem column. Loading, failure/retry, no-project and partial-search states are explicit. [N-app `projects-index-page-98a2096dcc1e.js:428,857–981,1021–1028,1274,1427–1445,1900–2161,2397–2505,3877–4029`]

The local-project empty-state explanation says the project organizes chats and gives ChatGPT access to folders on the computer. Project chat actions reveal on hover and keyboard focus. [N-app `projects-index-page-98a2096dcc1e.js:1383–1389,3099–3108,3515`]

The newer home also has broader suggestion/connection surfaces, including loading/no-suggestions/retry and cloud-only background suggestions. Those are combined-product discovery surfaces, not prerequisites for an agent workstation. [N-app `home-task-suggestions-8e6f3364dd78.js:850–908,1898–1953,3216–3287`]

**Verdict — import/adapt the projects index; skip generic discovery as the primary MAWS home.** A useful MAWS home can prioritize recent projects, running/attention sessions and a clear new-session entry.

## 3. Right-side tools, pinned summary and bottom terminal

### Pinned summary

The header distinguishes **“Toggle summary”** from **“Toggle pinned summary.”** Its own description defines pinning as whether the summary **reserves layout space**. Overlay mode uses a popover rather than that reserved-space toggle. The summary root defaults to **300px**; the popover is also 300px and caps height to available popover space or viewport minus 16px. Its spring transition is 0.3s with minimal bounce, with zero-duration branches for reduced/nonanimated modes. [N-app `local-conversation-page-620b0d289994.js:4886–4976`; `app-initial-d817715f10a0.js:300393–300447,300801–300825`]

The content is composed from collapsible sections with sticky, muted headings; section expansion uses persisted keys. Rows have truncated text, compact icons, and trailing actions that reveal on hover/focus/open state. This is not a large permanent dashboard. [N-app `app-initial-d817715f10a0.js:298241–298254,298324–298447,298755–298809,299646–299793`]

Recoverable summary content includes:

- **Environment/worktree section** with branch, loading/change metrics, review action and PR/MR relationships. Creation can replace the normal branch row until attachment completes. [N-app `local-conversation-thread-8d31f61b9a01.js:13260–13325,13438–13446`]
- **PR row** with status and change counts, View PR, code changes/status, Add to chat, and PR actions such as Open in GitHub/Copy link; merged state has relative-time copy. [same file:10575–10805,11279–11434]
- **Subagents** summary with at most four avatars, preferring active agents, working/done counts, and an Open subagents target. [same file:4001–4017,4234–4378]
- **Sources**, meaning information used by the conversation; its data includes external, file and tool sources, not just filesystem files. [same file:16715–16722,16834–16864]
- **Outputs / Recent files**, a separate summary collection. [same file:3674–3814]

**Verdict — adapt.** Use this as MAWS’s right-side resting summary, but do not assert Codex only ever shows it when every other panel is closed: the source has floating, pinned and overlay variants. In MAWS, define one understandable fallback policy and make each row open the corresponding auxiliary tool.

### Subagents panel

The overview has **Active · count** and **Done · count**, initially limiting visible rows to four active and ten done. The active empty state says **“No active subagents.”** Active includes any status other than done; a waiting subcount can appear in its header. [N-app `local-conversation-subagents-panel-tab-31c7c9525185.js:206–285,330–336,438–467`]

Each item uses a deterministic avatar seed and display name. Its preview prioritizes the objective truncated to 60 characters, then status summary, then **Working**. Thus it is not necessarily a live “current activity” sentence in every row. Active elapsed time updates every second; waiting is explicit; done rows show completion age. Selecting an item opens the subagent detail/transcript, with model/effort and **Back to subagents**. [same file:304–320,341–436,478–563]

**Verdict — import the list/drill-in structure; adapt for Claude SDK subagent events.** Show a topology view when useful, but retain a fast sortable/scannable overview. Distinguish objective, current activity and terminal status in the data model rather than combining them into one unreliable text field.

### Tab strip, “+”, maximize and the two small layout buttons

Content tabs support drag/drop, horizontal scrolling with scroll restoration, and a Task tabs accessible label. Context commands include Close, Close other tabs, Close tabs to the right, and pinning content to the sidebar. [N-app `app-initial-d817715f10a0.js:101335–101414,101473–101478,104602–104644,104817–104847,104965`]

The new-tab surface offers context-appropriate **Files, Side chat, Browser, Review, Terminal**, recent/suggested content and additional tools/plugin actions. There is a separate **Open bottom terminal** action. [N-app `thread-panel-toggle-button-b9c21edc979e.js:975–1063,1874–1877,2536–2626,2743,2838–2841`]

The two panel icons are:

1. **Toggle bottom panel** — hide/show the bottom region, retaining its tabs.
2. **Toggle side panel** — hide/show the task’s right content region.

They are not unified/split diff switches. [N-app `thread-app-shell-chrome-a984dd5a9408.js:637–711,850–872,1169–1285`]

The separate expand action says **Enter full screen / Exit full screen**, but its description and handler maximize/restore the **right panel’s width**, not macOS window fullscreen. Full/split workspace layout is another state and another command. A misleading `data-app-shell-workspace-layout-toggle="main"` wrapper actually contains a New tab action in this chunk. [N-app `app-initial-d817715f10a0.js:129459–129527,43207–43218,66195–66206`; `thread-app-shell-chrome-a984dd5a9408.js:269–366,1080–1094`]

The sample names “claude-usage” and “claudeusage” should be treated as content-tab titles, not identified tool types from their names alone. Static source inspection does not establish what those particular user-created tabs contain.

**Verdict — adapt.** Keep the three actions distinct. Prefer an unambiguous MAWS label such as **Maximize panel** over “full screen.” Preserve per-session tabs independently from MAWS’s central multi-session tabs.

### Diff and source-control tool

Review offers scopes such as This branch, Last turn, Uncommitted, Unstaged, Staged and Commits; multi-repository context can show All repos. The header adapts at a **625px container width**, rather than assuming full-window width. [N-app `thread-side-panel-tab-content-cd4029ad62b3.js:1262,1421,1500–1586`]

File review supports file filtering, viewed/unviewed markers, opening a file in a tab/external tool, file-tree show/hide, previous/next file, stage/unstage and revert. Revert distinguishes section/file/hunk failures and partial outcomes. Large diffs can switch to one-file-at-a-time or state **“Diff too large to display. Open the file to review changes directly.”** Missing git, no changes, no staged/unstaged changes, unavailable old turn diff and file-watch limits have distinct copy. [same file:2948–3373,3689–3827,4643–4786,6158–6172,6796–6980,7100–7207,7430–7486; N-app `review-file-tree-pane-71d2dbd0f8f0.js:47–146,3169`]

**Verdict — adapt.** Use task-scoped changes and repository-scoped state explicitly; a “last turn” diff is not the same thing as the current working tree. Import per-file navigation, visible stale/error states and confirmation for destructive reversion.

### Terminal, files and editor

The terminal uses xterm with retained renderer state, dynamic font/theme configuration, Clipboard/Fit/WebLinks addons, input forwarding and a full-height flex container. [N-app `terminal-panel-5cf641fe5a4f.js:915–959,1023,1203–1248`]

Terminal-tab states include Opening terminal, failure/New terminal, environment unavailable, waiting until the task has an environment, and the important **workspace mismatch warning** after a worktree change. A multi-root helper lists source directories and documents Opt/Alt+number to change directory. [N-app `terminal-tab-a9323a4c5e98.js:162–237,305,386–424,525–635`]

The file editor supports editable and read-only modes, find-in-file with previous/next result counts, source/preview switching, save/error handling and discard confirmation. Large files explicitly open read-only. The file-tree menu includes Save as, Copy path, Add to chat and Open with/in external tools. [N-app `text-file-editor-tab-content.electron-21d7439dc837.js:4682,5853–5934,6484–6487,7196–7202,7569–7631`; `base-file-tree-c9d6d05c9833.js:248–373`]

**Verdict — import terminal lifecycle and file-context safety; adapt editor scope.** MAWS can remain a workstation rather than recreate a full IDE, while still needing truthful read-only/dirty/save states.

### `progress-sidebar` is not agent progress

The newest chunk titled `progress-sidebar` shows **Data transfer**, category counts for Chats/Files/Memory/Automations/Plugins, transfer-complete/dismiss, loading failure and partial-transfer messages. It is an account/workspace migration surface. [N-app `progress-sidebar-bef10a2733e1.js:127–186,276–379,505`]

**Verdict — skip for MAWS’s agent-progress design.** Use the actual subagent and worktree-progress surfaces as benchmarks instead.

## 4. Composer control strip and worktree lifecycle

### Layout and state

The newest utility bar receives project, mode, environment host/root, worktree availability and branch-starting state. Its ordinary layout is a wrapping padded row with a **nonwrapping** control group; the home presentation scrolls its control group horizontally. Therefore the screenshot’s precise placement should not be treated as a universal fixed arrangement across modes. [N-app `composer-utility-bar-c4d6c9bca0c5.js:7383–7410,8410–8472`; `app-primary-cca0c1a58f0f.js:91400–91433`]

- **Project chip/picker:** keyboard-addressable combobox, searched workspace/cloud projects, clear-selection action and New project when search is empty. [N-app `app-primary-cca0c1a58f0f.js:86695–86755`; `composer-project-picker-content-a2db13761e8f.js:50–116,212–350`]
- **Execution location:** “Work in” for a new task versus “Continue in” for a follow-up; local, fresh worktree, remote/cloud and existing workspace/handoff options depend on context. Selecting worktree changes composer state; it is not itself proof checkout has completed. [N-app `composer-utility-bar-c4d6c9bca0c5.js:3180–3194,3365–3445,4865–4900,5540–5673`]
- **Environment:** selected environment name or Select environment; worktree environment configuration is bound to the execution host and workspace root. [same file:1327–1425,7690–7768]
- **Branch:** search and exact-ref support, keyboard Enter selection and a checkmark on the current choice. “Create and checkout new branch…” opens its own named dialog. Dirty-change handling can require commit-before-switch. [N-app `git-branch-switcher-bad799dfbbc4.js:1580–1618,1700–1750,1820–1865,1926–1956,2890–2930,3030–3055,3380–3558`]
- **Model/effort:** current model plus reasoning label; Select effort when editing an explicit model; picker/cycling commands. A screenshot label such as GPT-6 Astra High is a selected value, not a permanent shell label. [N-app `app-primary-cca0c1a58f0f.js:152350–152465,152570–152625`]
- **Permissions:** Ask for approval, Approve for me, Full access, Custom config and Managed are distinguishable states; availability can disable choices. Full access has explicit file/network/command reach confirmation. [N-app `permissions-mode-dropdown-d9457bb8a063.js:270–330,1530–1745,2700–2795`]
- **Mic:** idle Dictate, starting/cancel, transcribing, retry and submit states—not a decorative always-on voice button. [N-app `app-initial-d817715f10a0.js:485896,486156,486337–486448,486678–486683`]

**Verdict — adapt the context model and resilient strip.** Map project, cwd/worktree, model and permission displays to the actual Claude Code session. Reflect effective policy and runtime acknowledgements, not just optimistic local selection. Skip unsupported Codex cloud/auto-review semantics, and omit mic until recording/transcription actually work.

### Worktree progress, failure and reuse

The standalone build has a dedicated `/worktree-init-v2` route with cancel/work-locally/edit/auto-fix/continue/retry. The newest build integrates the process into the pending task, showing optional fetch/update, preparation, checkout and setup, with percentages, expandable output and a slow-update skip path. [S-app `worktree-init-v2-page-sNYzRRpX.js:289–336,570–680`; `/Users/new/codex-app-src/readable/codex-26.623/FILE-MAP.md:45–48`; N-app `local-conversation-thread-8d31f61b9a01.js:24760–25090`]

Failure can offer Retry, edit the precise environment, Cancel, work in the original folder, continue despite a setup failure when allowed, or start a distinct repair task. The repair prompt separates setup repair from the user’s original task. The compact summary transitions through **Creating worktree… → Attaching worktree… → Worktree ready**, with screen-reader status and reduced-motion-aware shimmer/pulse. [N-app `local-conversation-thread-8d31f61b9a01.js:25555–25589,25945–26089`; `worktree-creation-row-9375558be66e.js:65–80,187–258`]

A named **stable-versus-ephemeral worktree status badge was not recovered** in targeted latest strings/source searches. What is verified is managed-worktree reuse via **New chat in this worktree**, retaining files/branch, and settings for automatic deletion of old managed worktrees with snapshot-before-prune. Do not invent a “stable worktree” chip from that evidence. [N-app `worktrees-settings-page-eaa1aec6720d.js:705–785,1875–1927`]

**Verdict — import phased progress and actionable recovery; adapt reuse/lifetime policy.** Prefer the newest inline flow. Keep “retry setup,” “repair setup,” “use original checkout” and “continue without setup” separate decisions.

## 5. Thread header

The local task registers a titlebar header, with separately ordered header actions such as the summary toggle. This lets title and controls remain shell chrome rather than transcript content. [N-app `local-conversation-page-620b0d289994.js:4937–4943,5000–5010,5022–5035`]

**Share** is conditional and can show icon-only in compact state. It launches a read-only snapshot-sharing flow; account capabilities determine public/workspace/invited audiences, and Copy link stays disabled until ready/valid. It is not synonymous with copying the conversation to the clipboard. [N-app `app-primary-cca0c1a58f0f.js:160835–160922`; `share-thread-2c6cb355a9f3.js:3130–3175,3440–3505`]

The **ellipsis menu** centralizes rename, pin, unread, archive, copy Markdown/path/deep link, side chat and fork through contextual action definitions. Entries are state-dependent; the source does not imply every thread always gets the full menu. Layout/summary controls remain distinct from these task actions. [N-app `thread-overflow-menu-72238cb23898.js:109–165,565–710,995–1058`; `thread-app-shell-chrome-a984dd5a9408.js:850–872,1270–1285`]

**Verdict — adapt.** Keep a stable title/context header and contextual menu. Skip publication-style Share unless MAWS has a real storage/audience model; a local export/copy action should say what it actually does.

## 6. Dialogs, command menu and settings

### Dialog/modal grammar

`dialog-shell` handles title/subtitle, optional sticky header and scroll separator, bounded scrolling body, footer, form submission and dismissal lock. `modal-shell` portals into a viewport overlay, saves/restores focus, defaults to a 560px maximum-width presentation and guards dismissal/resize. [N-app `dialog-shell-e621c590b54e.js:19–36,145–239,258–281`; `modal-shell-2810dd204fc4.js:55–125,132–204,207–275`]

**Verdict — import behavior, adapt implementation.** MAWS needs one coherent dialog system, not two copied abstractions. Preserve focus restoration, visible keyboard focus, escape/dismiss rules, scroll containment and unsaved-state confirmation.

### Command menu

The menu is a centered searchable dialog with keyboard list navigation, quick actions, recent/pinned/chat results, drill-in/back and capability/host filtering. Its placeholder changes depending on the search domain. [N-app `command-menu-dialog-7ada12c7b127.js:718–809,916–961,982–1108,1330–1479`]

**Verdict — import/adapt.** One command registry should drive menu, shortcuts and tooltips. For MAWS, search sessions, projects, files and relevant actions; omit ChatGPT-specific product domains. Keep this distinct from the global hotkey composer window.

### Settings framework

Settings uses a searchable grouped sidebar, selected-section highlighting, arrow-key focus/navigation and URL-driven sections. Detail views use header/description/content rows rather than unrelated per-page layouts. [N-app `settings-page-858e8c35f656.js:733–802,1238–1251,1286–1405,2270–2298`; `local-environments-settings-page-51262040583d.js:325–430,493–559`]

| Surface | Observed behavior | MAWS verdict |
|---|---|---|
| Local environments | Per-project/inherited configurations; setup and cleanup scripts, actions, platform overrides and code/empty states. Failure recovery opens the exact config. [N-app `local-environments-settings-page-51262040583d.js:325–559,786–829,1340–1400`; `local-conversation-thread-8d31f61b9a01.js:26010–26043`] | **Adapt** to MAWS worktree setup hooks/config; do not assume Codex environment semantics. |
| MCP | Manager supports stdio command/args/env/cwd and streamable HTTP URL/auth/headers, enabled/auth state, project-read-only and plugin-contributed entries. [N-app `mcp-settings-ef147a503b0a.js:11–28`; `plugins-settings-87cc4982824f.js:987–1000,1120–1420,2118–2260`] | **Adapt** to Claude Code config ownership/precedence. Display origin and effective state. |
| Keyboard shortcuts | Capture combinations, detect conflicts, search by keystroke, number-shortcut preference, restore-default confirmation; Composer/Chat/App groups. [N-app `keyboard-shortcuts-settings-4ef52979a6f7.js:176–275,1050–1125,1540–1573,1680–1707,2023–2136,2208–2257`] | **Import/adapt** if remapping is supported; otherwise honest searchable documentation. |
| Usage | Your plan, credit balance/auto-reload, reset history, conditional 5-hour/weekly/daily/monthly limits, percentage remaining and reset times. [N-app `page-4079288cf98a.js:1530–1550,3950–4020,5090–5110,6865–6920,7540–7565,7830–7895`] | **Adapt** only genuine Claude/provider/session metrics; **skip** Codex credit sales. Preserve approximate/delayed-cost caveats where relevant. [N-app `app-initial-d817715f10a0.js:301784–301790,302066–302072`] |
| Skills/plugins | Installed plus optional Recommended sections, search/filter, refresh and New skill. [N-app `skills-page-3f57c3c5c2c4.js:890–950,1208–1327,1390–1499`] | **Adapt** local installed-skill inspection/management; **skip** unbacked marketplace recommendations. |

**Route correction:** these strings are not interchangeable aliases. Newest route definitions distinguish `/skills/manage` and its `/skills/manage/plugins` child; the PluginsSettings section is `/settings/plugins-settings`; `/settings/plugins/:server/:toolName` is an MCP plugin tool route. The `/plugins`/skills directory navigation also exists. Do not implement a settings IA by copying only the best-effort FILE-MAP route names. [N-app `app-shared-36eae88777f2.js:132563–132574`; `app-initial-d817715f10a0.js:283488–283509,389315–389327,393130–393147`]

## 7. Pull requests

The newest PR inbox is framed as **“Review and track work across GitHub”**, with loading/access/setup states, search, **All / Reviewing / Authored** views, status/repository filters and Open/Merged/Closed choices. It distinguishes no search matches, no PRs, caught-up, total failure and partial loading failure. GitHub CLI setup can expose install/copy-command, recheck and Ask Codex assistance. [N-app `pull-request-route-f3fecf0e2ff0.js:196–340,455–524,575–841,929–1038,1533–1828`; `app-initial-d817715f10a0.js:279235–279308,393151–393168`]

The list uses compact collapsible sections, small provider/avatar indicators and truncated metadata rather than large cards. Current detail components include editable description, checks with explicit passed/failed/in-progress/skipped/neutral/unknown states, activity/comments, reviewers, and opening a chat about the PR. [N-app `pull-request-route-f3fecf0e2ff0.js:1164–1238,1292–1351`; `pull-request-detail-query-ecd2c7e8c092.js:780–930,1079–1167,1310–1463,1573–1690,2122–2230,2975–3026`]

The standalone detail page explicitly demonstrates PR/code-review switching, related chats, reviewers, checks and activity. That older file is useful for the full page composition, but should not be misrepresented as a current chunk. [S-app `pull-requests-page-BLw5og7a.js:3850–3888,4090–4100,4290–4480,4690–4755`]

**Verdict — adapt the task↔PR relationship and summary row immediately; defer a standalone inbox until MAWS has GitHub integration.** The valuable pattern is contextual review and the ability to start a correctly scoped task from PR state, not duplicating every hosting-provider interface.

## 8. Automations

The scheduled-task page has search, **All / Active / Paused** filters, run-history mark-read/archive and frequency scheduling. Sidebar runs distinguish Running now, Run failed, No update and Run completed; older history can load progressively. [N-app `automations-page-7a88829f759b.js:619–685,1141–1215,3115–3175,3450–3485`; `sidebar-e702c2a88030.js:1217–1383`]

The detail panel separates editable/read-only title, toolbar status/actions, independently scrolling content and a fixed bordered footer. Its editor includes prompt/composer and a Details rail for execution location, chat destination, local project/model/effort and notification policy; cloud mode hides local-only controls. It warns that background execution uses configured sandbox settings and may run without approval prompts. [N-app `automation-detail-panel-e3354b9ee726.js:275–375,420–525,575–790,822–945`; `automation-dialog-875112766258.js:661–716`]

**Verdict — defer the scheduler UI until MAWS owns its execution semantics.** Preserve the useful relationships—schedule, run, resulting session, output and unread result—in the data model. Do not present scheduled execution as merely a date picker attached to an ordinary interactive session.

## 9. Design system and motion: MAWS interpretation

The useful design-system lesson is **semantic indirection plus restrained hierarchy**: surface, text, border, interaction, status and git-diff roles are separate tokens; compact muted chrome surrounds focused task content. The exact vendor palette and mark are not needed for MAWS. [N-CSS:3208–3214,3348–3418,3659–3679,5372–5379,5578–5586,5862–5882,5924–5930]

**Import** semantic roles, consistent spacing and focus/reduced-motion behaviors. **Adapt** typography and neutral surfaces to MAWS. **Skip** vendor-branded assets and decorative effects without a corresponding MAWS interaction. Use purposeful loading/transition motion, not an always-animated workstation.

## Appendix A. Token and geometry facts

### Palette

| Role | Light | Dark | Evidence |
|---|---|---|---|
| Main surface / underlying surface | white / #f9f9f9 | #181818 / black | N-CSS:3659–3679,5020–5036,5160–5165 |
| Main foreground | #1a1c1f | gray-fixed-150, #dfdfdf | same ranges |
| Danger/error text | red-500 #e02e2a | red-300 #ff6764 | N-CSS:3711–3716,5372–5379,5578–5586 |
| Warning text | orange-500 #e25507 | orange-300 #ff8549 | N-CSS:3751–3755,5372–5379,5578–5586 |
| Success/added indicator | green-500 #00a240 | green-300 #40c977 | N-CSS:3691–3694,5372–5379,5433–5450 |
| Deleted git indicator | red-600 #ba2623 | red-400 #fa423e | N-CSS:3712–3717,5433–5450 |
| Danger surface | red-25 | red-950 | N-CSS:5862–5882 |
| Warning surface | orange-25 | orange-950 | N-CSS:5862–5882 |

Diff editor backgrounds are distinct from saturated git indicators: supported `color-mix` branches use roughly **15% light / 23% dark** added/deleted hues. [N-CSS:5524–5538,5924–5930]

### Spacing, radius, type and fonts

- The old main stylesheet uses a **0.25rem spacing base**, radius bases from **0.125rem to 1.5rem**, scalable corners and toolbar heights **46/36/40px**. The new stylesheet retains these kinds of indirections and adds/extends semantic surface roles. [S-CSS:92–115,221–264; N-CSS:3348–3418,3462–3503,3552–3564]
- Latest UI sans delegates to `--font-ui-family`; code delegates to `--font-code-family`. There is a system-sans fallback, a system-monospace stack and separately available OpenAI Sans. Do not conclude every visible label is hardcoded OpenAI Sans merely because the font is bundled. [N-CSS:3208–3213,3348–3355,47690–47714,48027–48034]
- Heading token sizes are **24/20/18/16px**; body token sizes **18/16/14/12px**, with corresponding line-height tokens. Shell UI and code defaults refer to `--text-base` and `--text-sm`, allowing indirection rather than universal literal pixel sizes. [N-CSS:4484–4514,47690–47714]
- Both builds have supported-platform `corner-shape: superellipse(1.5)` handling. It is an enhancement, not a reason to make MAWS functionality depend on that CSS feature. [S-CSS:22116–22138; N-CSS:48007–48027]

### Geometry reference

- Primary window: 1280×820 default, 480×600 minimum; 46px primary titlebar alignment. [N-main `main-C5425b_s.js:240327–240352,240868–240975,241523–241537,242077–242135`]
- New sidebar: default 340px, 240–520px clamp with a content reserve. Old sidebar default: 300px. [N-app `app-initial-d817715f10a0.js:44378–44404`; S-app `app-initial~app-main~onboarding-page-CNHnOMz8.js:54070–54094`]
- Summary default/popover: 300px. Right tool panel: nominal 320px minimum, computed/persisted size. Bottom: 280px default, 160px minimum, half-height cap subject to its floor. [N-app `app-initial-d817715f10a0.js:300393–300412,300801–300825,42901–43034,136074–136175`]
- Projects-index responsive column removal: 680px. Review-header controls: 625px container threshold. [N-app `projects-index-page-98a2096dcc1e.js:428,1028`; `thread-side-panel-tab-content-cd4029ad62b3.js:1421`]

## Appendix B. The “21 animations” and their actual scope

The **21-keyframe count applies to the old main stylesheet**, not all styles in the old app and not the newest app. The newest extraction spreads many more definitions across feature stylesheets; its shared and initial stylesheets alone have 15 and 25 keyframe definitions respectively. Definitions are not proof of live shell use. [S-CSS:962–1016,22292–22473,22830–22842; N-CSS:48057–48158,48508–48525; N-shell-CSS:2–69,1310–1318]

All following old-build references are to **S-CSS**, the absolute file defined above. “Same-name selector” means the CSS class with the keyframe’s name; it identifies a declared consumer, not proof that every current screen applies it.

| Keyframe | Definition line | Declared use and timing |
|---|---:|---|
| `edge-fade` | 962 | `.vertical-scroll-fade-mask`, linear scroll-self-y timeline; no fixed duration. Usage:1090–1093. |
| `edge-fade-top` | 980 | `.vertical-scroll-fade-mask-top`, linear scroll-self-y. Usage:1120–1123. |
| `edge-fade-bottom` | 998 | `.vertical-scroll-fade-mask-bottom`, linear scroll-self-y. Usage:1150–1153. |
| `edge-fade-horizontal` | 1016 | `.horizontal-scroll-fade-mask`, linear scroll-self-x. Usage:1060–1063. |
| `loading-shimmer` | 22292 | `.loading-shimmer` and `.loading-shimmer-pure-text`: 2s, steps(48), infinite; inverted variant 5s, steps(120), 0.5s delay. Usage:1301–1333,1422–1451. |
| `generated-image-placeholder-pulse` | 22300 | Same-name class, 2.4s ease-in-out infinite. Usage:1357–1359. |
| `mcp-app-loading-pulse` | 22309 | Same-name `:before`, 3s ease-in-out infinite. Usage:1396–1400. |
| `app-brand-logo-shimmer` | 22318 | `.app-brand-logo-shimmer-overlay`, 2.2s cubic-bezier(0.4,0,0.2,1) infinite. Usage:1460–1475. |
| `browser-comment-popup-shake` | 22326 | Same-name class, 0.9s linear. Usage:4847–4852. |
| `browser-sidebar-design-editor-entry-enter` | 22350 | Same-name class, 90ms cubic-bezier(0.23,1,0.32,1). Usage:4855–4861. |
| `browser-sidebar-screenshot-click` | 22364 | Same-name class, 0.5s linear. Usage:4567–4574. |
| `browser-sidebar-device-rotate-click` | 22390 | Same-name class, 0.36s ease-out. Usage:4557–4564. |
| `browser-sidebar-screenshot-color-linger` | 22410 | Same-name class, 0.62s linear. Usage:4838–4844. |
| `browser-sidebar-zoom-icon-click` | 22424 | Same-name class, 0.22s cubic-bezier(0.23,1,0.32,1). Usage:4577–4585. |
| `right-panel-composer-overlay-enter` | 22435 | Same-name class, 0.12s `--cubic-enter`. Usage:4864–4869. |
| `paged-annotation-editor-enter` | 22443 | Same-name class, 0.15s ease-out. Usage:4588–4595. |
| `sync-dot-pass-down` | 22453 | No animation consumer recovered by searching old renderer JS/CSS. Do not present as verified live motion. |
| `sync-dot-pass-up` | 22473 | Same qualification: definition found, consumer not recovered. |
| `spin` | 22830 | `.animate-spin` / motion-safe variant; 1s linear infinite. Token:167; usage:4878–4879,16940–16944. |
| `ping` | 22835 | Before/after ping utilities; 1s cubic-bezier(0,0,0.2,1) infinite. Token:168; usage:14803–14806,15118–15121. |
| `pulse` | 22842 | `.animate-pulse`; 2s cubic-bezier(0.4,0,0.6,1) infinite. Token:169; usage:4875–4876. |

Reduced-motion overrides accompany many explicit effects, including shimmer and browser/sidebar effects. The newest generic loading shimmer remains a 2s stepped sweep with reduced-motion disabling. [S-CSS:1334–1339,4562–4597,4842–4869; N-CSS:2587–2627]

### Startup shimmer

Both builds’ HTML startup shells show a centered **56px masked logo**, fading in over **180ms after 60ms** and sweeping a **2200ms** shimmer. Reduced motion disables both animations. These inline startup keyframes are **additional to** the stylesheet count above. [ `/Users/new/codex-app-src/readable/codex-26.623/renderer/index.html:45–116`; `/Users/new/codex-app-src/readable/chatgpt-26.924/renderer/index.html:62–133` ]

**MAWS verdict — adapt the restrained startup treatment and accessibility, not the logo.** A neutral MAWS loading surface should communicate that the workstation is starting without implying agent execution has already begun.

## Final boundary of confidence

The source establishes component structures, declared styles, strings and state/action paths. It does not establish live feature-flag exposure, exact appearance under the user’s custom font/zoom/theme settings, or the contents of specifically named screenshot tabs. No stable/ephemeral worktree badge was verified. Those are the remaining areas for a later live UI pass—not gaps to fill with assumptions.

The immediate MAWS design implication is clear: **retain the planned project/session sidebar and multi-session central tabs, make task context and attention state explicit, and use the right area as a compact summary that opens focused tools.** The central multi-session tab system is MAWS’s own architectural choice; the surrounding operational behaviors are where Codex provides the strongest source-backed benchmark.