# MAWS charter

MAWS is a codename. This document is the chartering design for the project: what it is for, what was decided and why, what ships first, and how the pieces fit. It is the input to the execution spec and to the decomposition into milestones. Research behind every claim lives in `research/`.

Status: draft for approval, 2026-09-28. Decisions marked **D-n** were made with the project owner in the brainstorming rounds; decisions marked **S-n** are technical calls made by the design and can be overridden.

## 1. Purpose

**Higher purpose.** A general, state-of-the-art desktop workstation for supervising AI coding agents, built on the Claude Code engine. It replaces the Claude Code terminal UI, Claude Desktop's Code surface, and the Codex desktop app for its owner and a few colleagues. It is general at the base; the owner's own workflows (doperpowers, ptc, workflows, teams, orchestration ideas) arrive later as plugins on top of a strong base, not as hardcoded features. (D-5)

**What it is for.** Two scenes carry equal weight from the first release. (D-6)

- Scene A, supervision: several projects, many live sessions, approvals and questions pending, workflows running with many agents. Open MAWS and know within seconds where you are needed.
- Scene B, depth: one session with the diff panel open, a file tab beside the transcript, a terminal in the session's worktree, the browser showing the dev server the agent started.

**Benchmarks.** Codex desktop sets the interaction bar; it is the app generally praised for UX. Claude Desktop matters as Anthropic's own integration of the same engine we use, so it tells us how the engine is wired, what the app must own around it, and which behaviours the engine already expects from a host. (D-14)

**What it must not be.** Not "VS Code with a chat sidebar" and not "a chat app with a file tree". Not a thin client: the wire does not carry everything, and the app owns a real state layer around the engine. Not a fork of Claude Code: the engine binary stays unmodified. Nothing in either benchmark app actively annoys the owner; the terminal power features the GUIs drop (queued messages, `!` bash mode, keybindings, slash palette) are enhancements to add, not faults to fix. (D-13)

## 2. Decision log

| # | Decision | Reason |
|---|---|---|
| D-1 | Engine integration is a strict SDK-wire client plus an on-disk sidecar. No bundle patches. | The raw 2.1.283 control protocol exposes 85 control request types including structured reads for status, settings, hooks, permission rules, memory, skills, sandbox, workspace diff, export, usage and context usage, rename and title generation, fork and rewind, and a runtime workflow-progress field. The remaining gaps are narrow (per-message held-peer approval, native workflow pause/skip/retry, full auto-mode classifier traces, exact statusLine ledger). Patching a Bun standalone binary is not a dependable source-only edit; Claude Code ships roughly weekly. See `research/sdk-wire-gap.md` §3. |
| D-2 | Left panel is a collapsible project tree with sessions inside, plus a pinned "Needs you" section on top listing every session blocked on the human across all projects. | Cross-project attention is the point of Scene A; drill-down hides it. Codex's own sidebar already offers "Priority: needs input and unread first". |
| D-3 | Real engine from day one. A replay mode plays any Claude Code JSONL transcript into the UI for design iteration and tests. Static HTML mockups only for taste-heavy surfaces. | Fake data produces generic UX that the real wire then breaks. |
| D-4 | Visual identity: Codex-density chrome (dark-first, dense lists and panels) with Claude-style transcript typography (generous measure and line height for reading long prose). Own token set, structured like Claude's CDS. | Supervising many things wants density; reading agent prose wants comfort. |
| D-5 | Daily driver with a general base; owner-specific workflow as later plugins. | See purpose. |
| D-6 | Both scenes equal from day one. | See purpose. |
| D-7 | Claude-native engine with one adapter boundary. Only the Claude Code adapter is built. GPT models arrive through the owner's model gateway (ClaudeUsage's loopback relay: base URL, auth marker, gateway model discovery). The Codex agent is reachable only through bash. | Keeps workflows, skills, plugins and teams first-class while leaving a second engine possible without touching the UI. |
| D-8 | Main area is a browser-like tab strip with a single pane by default and one optional side-by-side split (drag a tab to the right edge). | Two panes cover the IDE scene; N-way editor groups add layout state and hurt keyboard navigation. |
| D-9 | No extension surface in P0. The whole extension model is next-phase work: a plugin API for side-panel tabs and commands mirroring Claude Code's own plugin host shape ranks above app-specific tools; app-specific tools (batch question sheet, agent-opened panels, custom transcript block renderers, browser control, orchestration) follow. | A strong base app comes first. Consequence: P0 renders AskUserQuestion with its existing schema; the richer question sheet and non-blocking questions wait. |
| D-10 | Right panel state belongs to the session, with any panel tab pinnable to stay across sessions. | Matches Codex's per-thread panels; the pin covers the "one terminal I always want" case. |
| D-11 | macOS arm64 only for the research preview. | Owner's platform; Claude Desktop is macOS-first. |
| D-12 | Claude Code's on-disk sessions are the store. MAWS keeps only an index. Any session started in the terminal opens in MAWS and the reverse. | Transcript, subagent transcripts, tool results, tasks and workflow journals are already durable under `~/.claude`; duplicating them would break terminal interop. |
| D-13 | Terminal power features are P0 enhancements: queued messages, steer, `!` bash mode, `#` memory, prompt history, slash palette, keybindings. | Owner's stated wish list. |
| D-14 | Benchmark weighting: Codex for interaction, Claude Desktop for engine wiring. | Owner's note. |
| D-15 | `CC-to-SDK` and its packages are not references and are not reused. | Owner's call: below the quality bar. |

## 3. Scope

### P0, the first release

- Shell: three regions (sidebar, main, right panel), persisted sizes, accessible resizers, native macOS window chrome with hidden inset title bar.
- Sidebar: Needs-you section, pinned sessions, project tree with sessions, "Other sessions" for sessions without a project, project "+" to start a session (cwd, new worktree, existing worktree), status glyphs, unread state, hover card, priority and recency sort, search.
- Sessions: start with cwd and additional directories, resume, fork (same directory or new worktree), rename with title provenance, archive, safe worktree cleanup.
- Main tabs: session tabs, file viewer tabs, diff tabs; single pane default, optional split; drag session rows to the tab strip.
- Transcript: streaming markdown with KaTeX, Mermaid and highlighted code; answer-first turns with a collapsible work disclosure; semantic activity groups → cells → full detail; change receipt per turn; subagent lifecycle rows; thinking disclosure; plan cards; questions; errors and reconnects; virtualised with stable scroll anchoring.
- Approvals: request docks at the composer locus and appears in Needs-you; keyboard approve/deny; scoped grants mapped to the engine's permission responses; abort and redelivery handling.
- Composer: rich editor; context strip (project, location, branch, model and effort, permission mode, add-dir); "+" menu (files and photos, slash commands, connectors, plugins); typed `@` context (files, agents, skills); slash palette; queue, steer, stop, resume semantics; queued message list; `!` bash mode; `#` memory; prompt history; drag-and-drop and paste of files and images.
- Status line under the composer: cwd, context usage, usage windows (5h, 7d), cost, permission mode; each opens a popover.
- Right panel, per session with pin: resting pinned summary (branch and diff stats, PR, subagents, background work, sent files, sources); tools: Subagents (Active/Done list, drill-in transcript, message a subagent), Review (diff of the session's changes with file navigation), Terminal in the session's cwd, Files (tree, opens viewer tabs), Sent files (renderer for images, video, audio, HTML, markdown, PDF), Background work (shells, monitors, tasks, workflows with phases and agents), Session info (context, usage, model, cost).
- Slash palette widgets translating the terminal's menu commands: model, effort, fast, permissions, usage, config, plugins, mcp, sandbox, hooks, memory, skills, agents, status, compact, context, rename, resume, export, diff.
- Notifications: OS notification when a session enters Needs-you while the window is unfocused; a global "next needs-you" shortcut.
- Replay mode: play a JSONL transcript into the UI at adjustable speed.
- Model gateway: per-app and per-session gateway toggle using ClaudeUsage's relay; gateway models in the model picker.

### P1

- File editor tab (CodeMirror 6) and editable merge view.
- Source control panel (stage, discard, commit, push, PR from a session's worktree).
- Bottom dock for the auxiliary panel host (terminal drawer).
- Browser panel as a separate WebContentsView with target-restricted automation and human takeover.
- Side chat (`/btw`), Tasks panel (TaskCreate lists), cross-session messaging and teams, scheduled loops.
- Multi-account usage from ClaudeUsage's ledger.
- Session replay scrubber over the JSONL (time travel).
- Native rendering of the owner's to-human output style as a "what Claude told me" lane (arrives with the renderer extension API).
- Dictation.

### P2

The deferred artifact work: docs, slides, design artifacts, comments, co-browsing (see the vault note "Claude Docs study").

### Next phase, logged, not designed

Extension model (D-9): plugin API for side-panel tabs and commands; app-specific tools exposed to the agent through an in-process MCP server (batch question sheet with files, design systems, repos and "decide for me"; async questions; open a panel; show a file; browser control); custom transcript block renderers; orchestration-driven multi-agent views.

## 4. Architecture

### 4.1 Process model

- **Renderer** (sandboxed, context-isolated): React 19 with the React Compiler, Tailwind v4, Radix primitives. Talks to the main process through a small validated command/event IPC schema. Never receives the shell, git or engine bridge directly.
- **Main process** (privileged): owns the engine adapter, the filesystem state service, the session index, the git service, notifications, windows and layout persistence.
- **Utility processes**: PTY host (node-pty), and a heavy-work worker for transcript indexing and search.
- **Engine child processes**: one `claude` process per live session, launched with `--input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio` and the session's cwd, additional directories, model, effort, permission mode, resume or fork flags. Version-pinned; the app records the engine version per session. (S-1)

### 4.2 Engine adapter

The adapter owns the raw NDJSON transport rather than wrapping the public SDK's `query()`. Reason: the public 0.3.259 `Query` type lacks wrappers for most 2.1.283 control requests, and two writers on the same stdin is a race. The adapter implements: initialize handshake with hook registration; request ids, cancellation and timeouts; `can_use_tool`, `hook_callback`, `elicitation`, `request_user_dialog` and AskUserQuestion round trips; outgoing control requests (interrupt, set_permission_mode, set_model, effort, get_usage, get_context_usage, get_settings, list_permission_rules, get_hooks_listing, get_memory_dialog, get_skills_dialog, get_sandbox_dialog, get_workspace_diff, export_conversation, rewind_conversation, fork_conversation, rename_session, generate_session_title, stop_task, reload_plugins, side_question); stdin frames (`user`, `bash_command`, `keep_alive`); unknown-field retention and unknown-frame journaling. (S-2)

Events are normalised into a graph keyed separately by session id, message uuid, API message id, tool-use id, task id and agent id. Child-agent traffic is attributed by `parent_tool_use_id` and never flattened into the parent conversation. Raw frames are journaled per session for replay and for compatibility diagnosis. (S-3)

### 4.3 Filesystem state service

One watcher plus append-aware JSONL tailers over the engine's own store (respecting `CLAUDE_CONFIG_DIR`):

- `projects/<slug>/<session>.jsonl` main transcripts, titles, compaction and rewind anchors; used for resume backfill, replay and terminal-started sessions.
- `projects/<slug>/<session>/subagents/agent-*.jsonl` and `.meta.json` for child transcripts and lineage.
- `tool-results/` for spilled large results, lazily loaded.
- `tasks/`, `workflows/` snapshots and journals, `sessions/<pid>.json` for live peers, `jobs/` for detached sessions, `teams/`.
- Settings, agents, skills, plugins and commands files for the palette and the management widgets.

The service never writes into engine-owned locks, mailboxes or journals.

### 4.4 Session service and index

SQLite (better-sqlite3) holds only what the engine does not: project list and membership, app session records (app id ↔ engine session id, title and its provenance, worktree, pin, archive state, last-seen cursor for unread), attention items, drafts and queued messages, tab and panel layout per session, replay fixtures. (S-4)

Session process policy: a process is live while a turn runs or its tab is open; after an idle period with the tab closed the process exits and the session resumes transparently on the next message. (S-5)

### 4.5 Git and worktree service

Read-only status, branch, diff and log through the `git` binary, with a repository watcher for the toolbar and pinned summary. Worktrees are ordinary trusted `git worktree add` under `<repo>/.claude/worktrees/`, the same convention the engine's own `EnterWorktree` uses, so both coexist. Cleanup distinguishes archive, remove a clean checkout, discard uncommitted changes and delete a branch. (S-6)

### 4.6 Permission broker

A request router with one pending table for tool permissions, questions, plan approvals, dialogs and elicitations. Each item carries request id, session, agent, tool, input preview, engine suggestions and the scope options the engine accepts. The renderer's answer is not authorization until the engine acknowledges the `control_response`; delivery failure returns the item to pending. Abort from the engine removes it. Items are the source of the Needs-you section. (S-7)

### 4.7 Libraries

Streamdown for streaming markdown with its KaTeX, Mermaid and Shiki plugins; TanStack Virtual with end anchoring for the transcript; `@git-diff-view/react` for review; CodeMirror 6 for file tabs (P1 editing); Tiptap for the composer; terminal renderer behind an adapter, ghostty-web first with xterm.js and its WebGL addon as the fallback, decided by the spike in §7; electron-vite, electron-builder and electron-updater; Zustand stores fed by IPC events, TanStack Query for request-response data. (S-8)

## 5. Information architecture

### 5.1 Sidebar

Top to bottom: search; **Needs you · N** (every session blocked on the human, across projects, ordered by wait time, each row showing project, title, the reason: approval, question, plan review, error; hover card previews the request and offers approve/deny or open); **Pinned**; **Projects** as collapsible groups, each with a status roll-up and a "+"; sessions inside with status glyph (working, needs you, idle unread, idle read, done, failed), title, secondary line (current activity while working, last assistant line when idle), age, unread dot; **Other sessions** for sessions without a project. Project actions: new session, add directory, mark all read, archive sessions, remove project, reveal in Finder. Session actions: open, open in split, pin, rename, fork, archive, delete conversation, remove worktree. Sort: priority (needs input and unread first) or recency. Sessions found on disk that MAWS did not start appear under their project automatically.

New session sheet from "+": location (project directory, new worktree with branch name, existing worktree), model and effort, permission mode, additional directories, first message optional.

### 5.2 Main area

Tab strip with session tabs (status glyph, title), file tabs, diff tabs, and "+". Middle-click closes; drag to reorder; drag to the right edge opens the second pane; closing the last tab in a pane collapses the split. ⌘1..9 select tabs, ⌃Tab cycles. A session row dragged from the sidebar opens a tab.

### 5.3 Transcript

Turn structure, adapted from Codex (see `research/codex-thread-ux.md` §2):

- User message: right-aligned bubble, attachments, copy, edit-and-resubmit (which forks history, stated explicitly), collapse beyond twenty lines.
- Assistant turn: **answer first**. While working, a work area shows the active activity group (latest running tool or "Thinking"). On completion the work area collapses under a divider "Worked for 2m 14s · 12 tool calls · 1 denied"; clicking expands; the denied count jumps to the denial.
- Activity groups: consecutive groupable tool calls form one group with a semantic summary in fixed category order (MCP sources, loaded skills, file changes, exploration, commands, web). Standalone rows break groups: subagent lifecycle, approvals, errors, plans, questions, images, change receipts. A completed single-item group unwraps to a cell. Expanded group is a bounded scroller with cells; each cell expands to detail (command, cwd, output with exit status; edit with inline diff; read with path chips; MCP result with raw escape hatch); "Open full log" sends the cell to the right panel.
- Change receipt at the end of a turn: first three changed files with line counts, "Review changes" into the Review tool, "Show N more", Undo and Reapply bound to the engine's rewind and file checkpoints.
- Subagent rows: seeded glyph per agent, grouped sentences ("A, B and C started working", "finished", "finished with errors"), up to four glyphs then "N more", click opens the Subagents tool with that agent selected. Messages between agents render as rows ("Sent message to reviewer", "Message from parent").
- Thinking: separate disclosure "Thinking / Thought for 12s", bounded.
- Plan: card with the plan body, "Implement this plan?" approval mapped to ExitPlanMode.
- Question (AskUserQuestion): inline form with numbered options, descriptions, recommended badge, previews, multi-select, free text; keyboard navigable; submit answers all questions.
- Errors and reconnects: transient rows with attempt counts; failed turns keep the partial output visible.
- Time separators after gaps; virtualised list with anchored reading position and a jump-to-latest control.

### 5.4 Composer and strip

Above the editor, a wrapping strip of chips: project, location (directory or worktree with branch), branch picker (search, create), model and effort, permission mode (default, acceptEdits, plan, auto, bypass), add directory. Below the editor: "+" (files and photos, slash commands, connectors, plugins), `@` context, mic (P1), and the submit control whose label follows state: Send, Stop, Queue, Steer, Resume. Queued messages list above the composer with edit, delete, steer, "queue paused because you interrupted". `!` prefix runs a shell command through the engine's bash frame and shows output as a replayed row; `#` prefix appends to memory. ArrowUp on an empty editor recalls history. Pasted text beyond a threshold becomes an attachment. Drag-and-drop files attach; images paste inline.

A pending permission or question replaces the composer surface with its card, naming the requesting agent, the exact operation, and the grant scope; Enter approves, Esc declines, the composer returns afterward. Slash palette: `/` opens a searchable list of engine commands, skills, custom commands and MAWS actions, each marked by origin; commands with a terminal menu open a widget over the transcript.

### 5.5 Status line

cwd · context used of window (with the autocompact threshold) · usage 5h and 7d with reset times · session cost · permission mode. Clicking opens popovers backed by `get_context_usage`, `get_usage` and settings. A usage banner appears above the composer when a window is near its limit.

### 5.6 Right panel

Tab strip with the session's tools, "+" to add a tool (Subagents, Review, Terminal, Files, Sent files, Background work, Session info), pin toggle per tab, maximize, close. Resting state with no tab open: the pinned summary, a compact card with collapsible sections: branch and diff stats with "Review", PR row (status, checks, open on GitHub), Subagents (avatars, active/done counts), Background work (N running), Sent files (recent), Sources (files and tools used). Every row opens its tool.

- Subagents: Active · N and Done · N lists; row shows glyph, name, objective or status, elapsed; drill-in shows the child transcript with the same renderer, model and effort, a composer to message it, and "Back". Nested children render under their parent. A topology view is a later addition, not the default.
- Review: file list and diff of the session's changes since its base (unified or split), file navigation, path chips open file tabs; P1 adds staging and commits.
- Terminal: PTY in the session's cwd; warns when the session moved to another worktree and offers a new terminal instead of pretending it moved.
- Files: tree rooted at the session's directories; click opens a viewer tab in the main area.
- Sent files: the collection of files the agent delivered through SendUserFile, rendered by type, with a back arrow from item to list.
- Background work: shells, monitors, task lists and workflows; a workflow shows title, description, phases with agent tables (model, tokens, time) and per-agent transcripts, stop control; pause, skip and retry are not available over the wire and are not shown.
- Session info: engine version, model, context, usage, cost, hooks and MCP status, permission rules.

### 5.7 Attention and notifications

An item enters Needs-you when a permission, question, plan approval, dialog or elicitation is pending, or when a turn ends in error. A session is "unread" when its turn ended while its tab was not visible. The sidebar glyph, the tab glyph, the Needs-you row and the OS notification all derive from the same attention table. ⌘⇧J jumps to the oldest Needs-you item; answering from the hover card is allowed for permissions with a visible input preview.

### 5.8 Keyboard

⌘N new session, ⌘K command palette, ⌘B sidebar, ⌘⇧B right panel, ⌘J bottom dock (P1), ⌘1..9 tabs, ⌃Tab cycle, ⌘W close tab, ⌘\ split, ⌘⇧J next Needs-you, Enter/Esc on a docked request, ⌘Enter send when the editor is multi-line, ⇧Tab cycles permission mode as in the terminal. All bindings editable.

## 6. Visual identity

Dark-first with a light theme. Chrome follows Codex density: 13px UI text, 4px spacing base, 6 to 12px radii, muted metadata at 60 percent foreground promoted on hover, thin separators, no heavy cards. Transcript follows Claude's reading comfort: 15 to 16px prose, 1.6 line height, 68 to 72 character measure, headings with clear rhythm, code at 13px monospace. Colors are semantic tokens (surface, surface-raised, foreground, foreground-muted, accent, success, warning, danger, diff-added, diff-removed) so the whole look can be re-skinned. Fonts are tokens too; the mockups use system fonts and the owner chooses.

## 7. Delegated unknowns

Empirical questions the design cannot settle; each has its resolving move and runs first.

1. **Protocol fixture probe** against the pinned 2.1.283 binary under MAWS's launch options: initialize and capability tokens, unknown-field preservation, a permission and a question round trip, nested and background child traffic, workflow progress, usage and context queries, queue and interrupt, rewind and fork, replayed user messages. Output: recorded fixtures that seed replay mode and conformance tests.
2. **Terminal spike**: ghostty-web with node-pty under real Claude Code and Codex TUI workloads (alternate screen, synchronized output, CJK and emoji, IME, selection, hyperlinks, scrollback, resize, sustained output). Fallback is xterm.js with WebGL.
3. **Transcript spike**: a long streaming transcript with nested child activity, markdown, code and diagrams, with TanStack Virtual end anchoring; verify that expanding old work never drags the reader back to the stream.
4. **Gateway behaviour**: model discovery and per-session gateway toggling with ClaudeUsage's relay; how usage windows report through `get_usage` when routed.
5. **Fonts and final tokens**: chosen from the mockups.

## 8. Milestones

- M0 Foundations: repository, electron-vite scaffold, IPC schema, engine adapter with the fixture probe, filesystem state service, session index, replay mode.
- M1 Shell and sessions: three regions, sidebar with Needs-you, session start with cwd and worktrees, tabs, basic transcript with streaming markdown, composer with the strip, approvals at the locus, status line.
- M2 Transcript information architecture: activity groups and cells, change receipts, subagent rows, thinking, plans, questions, errors, queue and steer.
- M3 Right panel tools: pinned summary, Subagents, Review, Terminal, Files and viewer tabs, Sent files, Background work and workflows, Session info.
- M4 Palette and widgets: slash palette, terminal-menu translations, model and effort, plugins, MCP, config, permissions, hooks, memory, sandbox, usage; settings; gateway.
- M5 Finish: keyboard map, notifications, layout persistence, split pane, worktree lifecycle and cleanup, packaging and signing for internal distribution.

M0 through M5 share the data model and the adapter contract, so the whole design is matured here and then decomposed; each milestone becomes its own spec.

## 9. Research index

- `research/codex-thread-ux.md`: transcript, activity grouping state machine, approvals, composer, queue semantics.
- `research/codex-shell-ux.md`: shell geometry, sidebar organisation, pinned summary, subagents panel, composer strip, worktree lifecycle, tokens.
- `research/claude-desktop-ux-and-engine.md`: Claude Code session UI on claude.ai, the 307-method LocalSessions contract, how Desktop spawns and brokers the engine.
- `research/sdk-wire-gap.md`: the complete 2.1.283 wire, the 67-row gap matrix, the four app-side mechanisms.
- `research/landscape.md`: other agent workstations, terminal embedding, rendering libraries, Electron practice, Playwright over a WebContentsView.
