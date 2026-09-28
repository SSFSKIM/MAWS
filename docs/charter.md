# MAWS charter

> **Parent:** root, the project's standing purpose (this document is the root spec; `CLAUDE.md` points here). **Level name:** P0, the first release. Children dispatch per their grain hint in §12, each carrying its section as its spec; each child's artifact (execution document, ledger, findings) opens by citing this document, its child id, and the parent pin (the git blob hash of this file at dispatch).

MAWS is a codename. This document is the chartering design for the project: what it is for, what was decided and why, what ships first, and how the pieces fit. It is the root spec: the approved design up top and, from §10 on, the decomposition into children. Research behind every claim lives in `research/`.

Status: approved by the owner on 2026-09-28 after one critique round and the protocol probe; routed to decomposition into milestone specs. Decisions marked **D-n** were made with the project owner in the brainstorming rounds; decisions marked **S-n** are technical calls made by the design and can be overridden.

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
| D-4 | Visual identity: Codex-density chrome (dense lists and panels) with Claude-style transcript typography (generous measure and line height for reading long prose), in Claude's bright, light-first style with a dark theme as the alternate. Own token set, structured like Claude's CDS. | Supervising many things wants density; reading agent prose wants comfort; the owner prefers Claude's bright look over Codex's dark one (mockups were reviewed dark and judged excellent in structure). |
| D-5 | Daily driver with a general base; owner-specific workflow as later plugins. | See purpose. |
| D-6 | Both scenes equal from day one. | See purpose. |
| D-7 | Claude-native engine with one adapter boundary. Only the Claude Code adapter is built. GPT models arrive through the owner's model gateway (ClaudeUsage's loopback relay: base URL, auth marker, gateway model discovery). The Codex agent is reachable only through bash. | Keeps workflows, skills, plugins and teams first-class while leaving a second engine possible without touching the UI. |
| D-8 | Main area is a browser-like tab strip with a single pane by default and one optional side-by-side split (drag a tab to the right edge). | Two panes cover the IDE scene; N-way editor groups add layout state and hurt keyboard navigation. |
| D-9 | No extension surface in P0. The whole extension model is next-phase work: a plugin API for side-panel tabs and commands mirroring Claude Code's own plugin host shape ranks above app-specific tools; app-specific tools (batch question sheet, agent-opened panels, custom transcript block renderers, browser control, orchestration) follow. | A strong base app comes first. Consequence: P0 renders AskUserQuestion with its existing schema; the richer question sheet and non-blocking questions wait. |
| D-10 | Right panel state belongs to the session, with any panel tab pinnable to stay across sessions. | Matches Codex's per-thread panels; the pin covers the "one terminal I always want" case. |
| D-11 | macOS arm64 only for the research preview. | Owner's platform; Claude Desktop is macOS-first. |
| D-12 | Claude Code's on-disk sessions are the store. MAWS keeps only an index. Any session started in the terminal opens in MAWS and the reverse. | Transcript, subagent transcripts, tool results, tasks and workflow journals are already durable under `~/.claude`; duplicating them would break terminal interop. A session that is live in another process (a terminal, a `--bg` job) is shown read-only as "foreign-live" (§5.1) rather than resumed into a second writer. |
| D-13 | Terminal power features are P0 enhancements: queued messages, steer, `!` bash mode, `#` memory, prompt history, slash palette, keybindings. | Owner's stated wish list. |
| D-14 | Benchmark weighting: Codex for interaction, Claude Desktop for engine wiring. | Owner's note. |
| D-15 | `CC-to-SDK` and its packages are not references and are not reused. | Owner's call: below the quality bar. |
| D-16 | Sessions do not survive an app restart or crash in P0; the engine host runs in a utility process and quitting with turns in flight asks first. A detachable supervisor is P1. | Same trade-off Codex and Claude Desktop make; resume from disk covers the rest. |
| D-17 | Account-wide usage windows stay in every session's status line, backed by one shared ClaudeUsage read. | Owner's stated design; the cost objection is moot with a single source. |
| D-18 | Auto permission mode is the default for new sessions (inherited from the owner's settings), and few permission prompts are expected. Needs-you is designed around questions, plan reviews, classifier escalations and errors, not a stream of approvals. | Owner's note; matches how they run the terminal. |

## 3. Scope

### P0, the first release

- Shell: three regions (sidebar, main, right panel), persisted sizes, accessible resizers, native macOS window chrome with hidden inset title bar.
- Sidebar: Needs-you section, pinned sessions, project tree with sessions, "Other sessions" for sessions without a project, project "+" to start a session (cwd, new worktree, existing worktree), status glyphs, unread state, hover card, priority and recency sort, search.
- Sessions: start with cwd and additional directories, workspace trust (a trust step in the new-session sheet for directories never trusted, attested to the engine at initialize so project settings, hooks, MCP servers and plugins load exactly as in the terminal), resume, fork (same directory, or new worktree by copying the transcript under the new project slug and launching with the fork flag, with rollback), rename with title provenance, archive, safe worktree cleanup. Sessions live in another process appear as foreign-live: transcript tailed read-only, holder shown, composer and approvals disabled, "attach in a terminal tab" for background jobs.
- Overview: a main-area board, the default tab, one card per live or unread session grouped by project with Needs-you first: current activity, last assistant line, the pending request inline and answerable when the card is focused, context percentage, cost since last seen, child-agent count, branch and dirty state. This is Scene A's primary surface; the sidebar section is its index.
- Quit and reload safety: the engine adapter and process table live in a utility process so renderer reloads never touch sessions; quitting with turns in flight asks "N sessions mid-turn" first. Sessions do not outlive the app in P0.
- Main tabs: session tabs, file viewer tabs, diff tabs; single pane default, optional split; drag session rows to the tab strip.
- Transcript: streaming markdown with KaTeX, Mermaid and highlighted code; answer-first turns with a collapsible work disclosure; semantic activity groups → cells → full detail; change receipt per turn; subagent lifecycle rows; thinking disclosure; plan cards; questions; errors and reconnects; virtualised with stable scroll anchoring.
- Approvals: request docks at the composer locus and appears in Needs-you; keyboard approve/deny; scoped grants mapped to the engine's permission responses; abort and redelivery handling.
- Composer: rich editor; context strip (project, location, branch, model and effort, permission mode, add-dir); "+" menu (files and photos, slash commands, connectors, plugins); typed `@` context (files, agents, skills); slash palette; queue, steer, stop, resume semantics; queued message list; `!` bash mode; `#` memory; prompt history; drag-and-drop and paste of files and images.
- Status line under the composer: cwd, context usage, usage windows (5h, 7d), cost, permission mode; each opens a popover.
- Right panel, per session with pin: resting pinned summary (branch and diff stats, PR, subagents, background work, sent files, sources); tools: Subagents (Active/Done list, drill-in transcript, message a subagent), Review (diff of the session's changes with file navigation), Terminal in the session's cwd, Files (tree, opens viewer tabs), Sent files (renderer for images, video, audio, HTML, markdown, PDF), Background work (shells, monitors, tasks, workflows with phases and agents), Session info (context, usage, model, cost).
- Slash palette widgets translating the terminal's menu commands: model, effort, fast, permissions, usage, config, plugins, mcp, sandbox, hooks, memory, skills, agents, status, compact, context, rename, resume, export, diff.
- Notifications: OS notification when a session enters Needs-you while the window is unfocused; a global "next needs-you" shortcut. Ships with the first shell milestone, not as polish.
- Replay mode: play a JSONL transcript into the UI at adjustable speed.
- Model gateway: per-app and per-session gateway toggle using ClaudeUsage's relay; gateway models in the model picker.
- Usage windows: the status line and its popover read the active account's 5h and 7d windows and reset times from ClaudeUsage's local data, since the engine's usage read returns no windows through the gateway; session cost and context come from the engine.

### P1

- File editor tab (CodeMirror 6) and editable merge view.
- Source control panel (stage, discard, commit, push, PR from a session's worktree).
- Bottom dock for the auxiliary panel host (terminal drawer).
- Browser panel as a separate WebContentsView with target-restricted automation and human takeover.
- Side chat (`/btw`), Tasks panel (TaskCreate lists), cross-session messaging and teams, scheduled loops.
- All-accounts usage view from ClaudeUsage's ledger (P0 shows the active account only).
- Session replay scrubber over the JSONL (time travel).
- Detachable session supervisor over a Unix socket so sessions outlive app restarts and updates; triggered when update restarts or crashes start costing real turns.
- Prewarmed spare session (`--await-claim` and `claim_session`) for instant "+" starts.
- Native rendering of the owner's to-human output style as a "what Claude told me" lane (arrives with the renderer extension API).
- Dictation.

### P2

The deferred artifact work: docs, slides, design artifacts, comments, co-browsing (see the vault note "Claude Docs study").

### Next phase, logged, not designed

Extension model (D-9): plugin API for side-panel tabs and commands; app-specific tools exposed to the agent through an in-process MCP server (batch question sheet with files, design systems, repos and "decide for me"; async questions; open a panel; show a file; browser control); custom transcript block renderers; orchestration-driven multi-agent views.

## 4. Architecture

### 4.1 Process model

- **Renderer** (sandboxed, context-isolated): React 19 with the React Compiler, Tailwind v4, Radix primitives. Talks to the main process through a small validated command/event IPC schema. Never receives the shell, git or engine bridge directly.
- **Main process** (privileged): owns windows, layout persistence, notifications, the session index, the git service, and the IPC boundary.
- **Utility processes**: the engine host (engine adapter, process table and filesystem state service, so a renderer reload or window crash never touches a session), the PTY host (node-pty), and a heavy-work worker for transcript indexing and search.
- **Engine child processes**: one `claude` process per live session. Launch line: `-p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio --include-partial-messages --forward-subagent-text --replay-user-messages --include-hook-events --setting-sources user,project,local`, plus cwd, additional directories, model, effort, permission mode (auto by default, per D-18, inherited from settings), and resume or fork flags. The binary is an absolute pinned path, never resolved through PATH. The environment is constructed, not inherited: at startup the app captures the login shell's environment once (as Claude Desktop's shell-path worker does) and passes an allowlist (PATH, HOME, locale, `CLAUDE_*`, `ANTHROPIC_*` and the tool paths the engine needs), because a Dock-launched app has none of the shell's exports. It adds `CLAUDE_CODE_FORK_SUBAGENT=true` so fork-type subagents work as in the terminal, the gateway variables only when routing is on (chosen at launch; changing it restarts the process), and passes the owner's `ANTHROPIC_DEFAULT_*_MODEL` overrides through when present, since they are part of the routing setup; Session info shows which overrides are in effect. The host's `initialize` sets `perTaskStopAffordance: true` (otherwise Stop kills every background agent and workflow), `supportedDialogKinds`, `workspaceTrust` attestation, and dialog expiry "never" through flag settings so unanswered dialogs and elicitations wait for the human. Version-pinned; the app records the engine version per session. (S-1)

### 4.2 Engine adapter

The adapter owns the raw NDJSON transport rather than wrapping the public SDK's `query()`. Reason: the public 0.3.259 `Query` type lacks wrappers for most 2.1.283 control requests, and two writers on the same stdin is a race. The adapter implements: initialize handshake with hook registration; request ids, cancellation and timeouts; `can_use_tool`, `hook_callback`, `elicitation`, `request_user_dialog` and AskUserQuestion round trips; outgoing control requests (interrupt, set_permission_mode, set_model, effort, get_usage, get_context_usage, get_settings, list_permission_rules, get_hooks_listing, get_memory_dialog, get_skills_dialog, get_sandbox_dialog, get_workspace_diff, export_conversation, rewind_conversation, fork_conversation, rename_session, generate_session_title, stop_task, reload_plugins, side_question); stdin frames (`user`, `bash_command`, `keep_alive`); unknown-field retention and unknown-frame journaling. (S-2)

Events are normalised into a graph keyed separately by session id, message uuid, API message id, tool-use id, task id and agent id. Child-agent traffic is attributed by `parent_tool_use_id` and never flattened into the parent conversation. Raw frames are journaled per session for replay and for compatibility diagnosis. (S-3)

Verified against the real binary by the protocol probe (`spikes/protocol-probe/`, fixtures under `fixtures/`), which corrects the spec-derived picture in these places:

- No host handshake is required; the first `user` frame starts the session and `system/init` arrives per turn, carrying the command, skill, agent and model lists the palette needs (`get_skills_dialog` returned empty, so the palette reads `init`).
- AskUserQuestion reaches the host as a `can_use_tool` request flagged `requires_user_interaction`; the answer is an allow with `updatedInput.answers` keyed by question text. There is no separate question request type to implement.
- A denied tool produces an error `tool_result` and `result.permission_denials`; no `system/permission_denied` frame appears on this path. `permission_suggestions` can be absent. `updatedPermissions` rules with session destination take effect immediately.
- Child agents deliver their assistant and user records with `parent_tool_use_id`, per message, with no token-level `stream_event` for children. Subagent panels therefore update per message, and their full transcripts are the `agent-*.jsonl` files on disk. Both children in the probe ran in the background even when only one asked to.
- `--resume` restores the session but never replays history over the wire; the transcript view is rebuilt from the JSONL by the filesystem service. `fork_conversation` answered "unsupported" in a routed session; forking is the `--fork-session` launch flag.
- `bash_command` output comes back as replayed `user` records tagged as bash input, stdout, stderr and exit code, bracketed by command-lifecycle frames; the replayed-row renderer keys on those tags, and the app-owned queue does not count that lifecycle as a released user message.
- Interrupt with `cancel_queued` cancels queued messages explicitly; the running turn ends as `error_during_execution` with terminal reason `aborted_streaming`, and the next turn resumes. `bash_command` yields replayed user frames tagged as bash input, stdout, stderr and exit code.
- All thirteen structured reads succeed. `get_usage` returned session accounting but no rate-limit windows, so the status line takes its 5h and 7d windows from ClaudeUsage, with the engine's windows as the fallback for unrouted sessions.
- Every first-pass scenario ran routed through the model gateway (the shell exports the gateway variables and model overrides), with empty settings sources and strict MCP. The usage, fork and model-catalogue observations are therefore routed-only and bare-process figures; the second pass repeats those scenarios unrouted and under the owner's real settings.
- One bare engine process idles at roughly 280 to 350 MB resident; the real per-session cost is the process tree including stdio MCP servers, measured in the second pass.

Further engine semantics the design commits to:

- **Queue ownership.** MAWS owns the message queue: queued messages persist in the index and one is released into the engine when a turn ends; Steer bypasses the queue with immediate priority. The engine's own in-memory queue is not used for user drafts, so the queue survives process exit.
- **Plan approval** has three outcomes: implement (allow, which restores the pre-plan permission mode), clear context and implement (deny, set the mode, start a fresh turn seeded with the plan), keep planning (deny with feedback). A conversation reset renders as a transcript boundary row.
- **`!` bash mode** sends the `bash_command` frame and then a non-querying `user` frame carrying the command and its output so the result lands in the model's context as it does in the terminal; if the probe shows the frame is not accepted, `!` is documented as terminal-only. **`#` memory** has no wire mechanism; it is an app-side append to the memory file chosen from `get_memory_dialog`.
- **Revisable log.** Retractions (`supersedes`, retracted message uuids), refusal fallbacks, `compact_boundary` and compacting status are events the renderer applies, not ignores; the transcript is not append-only.
- **Edit and resubmit** forks by default; rewind is an explicit action.

### 4.3 Filesystem state service

One watcher plus append-aware JSONL tailers over the engine's own store (respecting `CLAUDE_CONFIG_DIR`):

- `projects/<slug>/<session>.jsonl` main transcripts, titles, compaction and rewind anchors; used for resume backfill, replay and terminal-started sessions.
- `projects/<slug>/<session>/subagents/agent-*.jsonl` and `.meta.json` for child transcripts and lineage.
- `tool-results/` for spilled large results, lazily loaded.
- `tasks/`, `workflows/` snapshots and journals, `sessions/<pid>.json` for live peers, `jobs/` for detached sessions, `teams/`.
- Settings, agents, skills, plugins and commands files for the palette and the management widgets.

The service never writes into engine-owned locks, mailboxes or journals. The main JSONL is not append-only: rewind truncates it and persists an anchor, so the tailer re-anchors by uuid chain rather than byte offset. Whole-file sidecars (`.meta.json`, `custom-title.json`, workflow snapshots) are parsed with retry because their write atomicity is unknown. Spilled results are loaded by the path the engine reports, never by a derived name, because background shell output and regular spills use different keys. The project slug is derived from the realpath of the directory, not the path as passed, so the service maps a session id to its files by discovery (`projects/*/<session>.jsonl`) or by realpath-then-slug, never from a cwd string, and reads the session's directory from the first JSONL record. Live holders are read from `sessions/<pid>.json`.

### 4.4 Session service and index

SQLite (better-sqlite3) holds only what the engine does not: project list and membership, app session records (app id ↔ engine session id, title and its provenance, worktree, pin, archive state, last-seen cursor for unread), attention items, drafts and queued messages, tab and panel layout per session, replay fixtures. (S-4)

Session process policy is memory-budgeted, never a fixed timer. A process stays live while it has a running turn, background tasks or workflows, session-scoped permission grants, connected MCP servers per `mcp_status`, or a held peer message. Idle processes without those are candidates for exit only under budget pressure, least recently used first. The budget is measured in the second probe pass under the owner's real settings, counting the whole process tree under the engine pid (stdio MCP servers included), and is visible in Session info. When a process with session grants must exit, the app snapshots the grants it issued (it sees every `updatedPermissions` it sent) and re-applies them on resume through flag settings; the probe verifies that path. Exit never silently discards background work: the user is asked. Until the budget policy ships (C12), engine processes never exit on their own: only archive, quit, or an explicit stop ends one. (S-5)

### 4.5 Git and worktree service

Read-only status, branch, diff and log through the `git` binary, with a repository watcher for the toolbar and pinned summary. Worktrees are ordinary trusted `git worktree add` under `<repo>/.claude/worktrees/`, the same convention the engine's own `EnterWorktree` uses, so both coexist. Cleanup distinguishes archive, remove a clean checkout, discard uncommitted changes and delete a branch. (S-6)

### 4.6 Permission broker

A request router with one pending table for tool permissions, questions, plan approvals, dialogs and elicitations. Each item carries request id, session, agent, tool, input preview, engine suggestions and the scope options the engine accepts. Items move through pending, delivered, and confirmed or retired. "Delivered" is not an alarm state: a long command keeps an item delivered for minutes with nothing wrong. There is no acknowledgement frame for a `control_response`: delivery truth is a successful write to a live process; the only failure signals are a stdin write error and process exit; confirmation is the earliest frame carrying the item's tool-use id (tool result, tool progress, hook frame, denial record). If the process exits with delivered or pending items, the broker raises one Needs-you entry at exit time from its own table ("session interrupted, N approvals lost"); on resume the engine retires the dangling tool calls itself and will not ask again, so nothing is re-pended. Abort from the engine removes an item. Items are the source of the Needs-you section. (S-7)

### 4.7 Libraries

Streamdown for streaming markdown with its KaTeX, Mermaid and Shiki plugins; TanStack Virtual with end anchoring for the transcript; `@git-diff-view/react` for review; CodeMirror 6 for file tabs (P1 editing); Tiptap for the composer; terminal renderer behind an adapter, ghostty-web first with xterm.js and its WebGL addon as the fallback, decided by the spike in §7; electron-vite, electron-builder and electron-updater; Zustand stores fed by IPC events, TanStack Query for request-response data. (S-8)

## 5. Information architecture

### 5.1 Sidebar

Top to bottom: search; **Needs you · N** (every session blocked on the human, across projects, ordered by wait time, each row showing project, title, the reason: approval, question, plan review, error, interrupted; hover card previews the request with its full input and offers open, and approve or deny by explicit click only for read-only tools; keyboard approval happens only in the focused session pane or focused Overview card); **Pinned**; **Projects** as collapsible groups, each with a status roll-up and a "+"; sessions inside with status glyph (working, needs you, idle unread, idle read, done, failed, foreign-live), title, secondary line (current activity while working, last assistant line when idle), age, unread dot; **Other sessions** for sessions without a project. Project actions: new session, add directory, mark all read, archive sessions, remove project, reveal in Finder. Session actions: open, open in split, pin, rename, fork, archive, delete conversation, remove worktree. Sort: priority (needs input and unread first) or recency. Sessions found on disk that MAWS did not start appear under their project automatically.

New session sheet from "+": location (project directory, new worktree with branch name, existing worktree), model and effort, permission mode, additional directories, first message optional.

### 5.2 Main area

Tab strip with the Overview tab first (⌘0, the default when the app opens), session tabs (status glyph, title), file tabs, diff tabs, and "+".

The **Overview** board is Scene A's surface. Cards are grouped by project with a Needs-you group on top. A card shows the session title and branch with a dirty marker, the status glyph and current activity line, the last assistant line, the pending request inline (the same card the composer would dock, answerable with Enter and Esc when the card has focus), context percentage, cost since last seen, and child-agent count. Clicking a card opens the session tab; the sidebar row deep-links to the card. Cards for foreign-live sessions show the holder and no controls. Middle-click closes; drag to reorder; drag to the right edge opens the second pane; closing the last tab in a pane collapses the split. ⌘1..9 select tabs, ⌃Tab cycles. A session row dragged from the sidebar opens a tab.

### 5.3 Transcript

Turn structure, adapted from Codex (see `research/codex-thread-ux.md` §2):

- User message: right-aligned bubble, attachments, copy, edit-and-resubmit (which forks history, stated explicitly), collapse beyond twenty lines.
- Assistant turn: **answer first**. While working, a work area shows the active activity group (latest running tool or "Thinking"). On completion the work area collapses under a divider "Worked for 2m 14s · 12 tool calls · 1 denied"; clicking expands; the denied count jumps to the denial.
- Activity groups: consecutive groupable tool calls form one group with a semantic summary in fixed category order (MCP sources, loaded skills, file changes, exploration, commands, web). Standalone rows break groups: subagent lifecycle, approvals, errors, plans, questions, images, change receipts. A completed single-item group unwraps to a cell. Expanded group is a bounded scroller with cells; each cell expands to detail (command, cwd, output with exit status; edit with inline diff; read with path chips; MCP result with raw escape hatch); "Open full log" sends the cell to the right panel.
- Change receipt at the end of a turn: first three changed files with line counts, "Review changes" into the Review tool, "Show N more", Undo and Reapply bound to the engine's rewind and file checkpoints.
- Subagent rows: seeded glyph per agent, grouped sentences ("A, B and C started working", "finished", "finished with errors"), up to four glyphs then "N more", click opens the Subagents tool with that agent selected. Messages between agents render as rows ("Sent message to reviewer", "Message from parent").
- Thinking: separate disclosure "Thinking / Thought for 12s", bounded.
- Plan: card with the plan body and the three outcomes of §4.2: implement, clear context and implement, keep planning with feedback.
- Question (AskUserQuestion): inline form with numbered options, descriptions, recommended badge, previews rendered in an isolated frame with no privileged access, multi-select, free text; keyboard navigable; submit answers all questions.
- Boundary rows for compaction, conversation reset and retraction, so the visible transcript matches what the model has.
- Errors and reconnects: transient rows with attempt counts; failed turns keep the partial output visible.
- Time separators after gaps; virtualised list with anchored reading position and a jump-to-latest control.

### 5.4 Composer and strip

Above the editor, a wrapping strip of chips: project, location (directory or worktree with branch), branch picker (search, create), model and effort, permission mode (default, acceptEdits, plan, auto, bypass), add directory. The permission chip shows the engine's effective mode from the initialize response and each init frame, never the optimistic selection; when a mode change is refused (auto mode is gated per model, fast mode, settings and a circuit breaker) the chip shows the refusal code in words, and the server-side classifier fallback dialog (Continue or Stop) is answered like any other request. Below the editor: "+" (files and photos, slash commands, connectors, plugins), `@` context, mic (P1), and the submit control whose label follows state: Send, Stop, Queue, Steer, Resume. Queued messages list above the composer with edit, delete, steer, "queue paused because you interrupted". `!` prefix runs a shell command through the engine's bash frame and shows output as a replayed row; `#` prefix appends to memory. ArrowUp on an empty editor recalls history. Pasted text beyond a threshold becomes an attachment. Drag-and-drop files attach; images paste inline.

A pending permission or question replaces the composer surface with its card, naming the requesting agent, the exact operation, and the grant scope; Enter approves, Esc declines, the composer returns afterward. Slash palette: `/` opens a searchable list of engine commands, skills, custom commands and MAWS actions, each marked by origin; commands with a terminal menu open a widget over the transcript.

### 5.5 Status line

cwd · context used of window (with the autocompact threshold) · usage 5h and 7d with reset times · session cost · permission mode. Context and cost are per session and come from `get_context_usage` and the engine's accounting; the usage windows are account-wide and come from one ClaudeUsage read shared by every session, with the engine's own `get_usage` windows as the fallback for an unrouted session when ClaudeUsage is unavailable, so showing them under each composer costs nothing and matches the owner's design. Clicking opens popovers. A near-limit banner is account-wide too and appears once per window, not above every composer.

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

With auto mode as the default (D-18), most items are questions, plan reviews, the classifier's escalations and errors; ordinary approvals are the exception, not the stream. An item enters Needs-you when a permission, question, plan approval, dialog or elicitation is pending, when a turn or background task ends in error, when a process exits unexpectedly or retires answers, or when a peer message is held (informational, and it expires, so the row says so). A session is "unread" when its turn ended while its tab was not visible. The sidebar glyph, the tab glyph, the Overview card, the Needs-you row and the OS notification all derive from the same attention table. ⌘⇧J jumps to the oldest Needs-you item. Under a split, Enter and Esc bind to the focused pane only. Stream deltas are batched per animation frame before crossing IPC.

### 5.8 Keyboard

⌘N new session, ⌘K command palette, ⌘B sidebar, ⌘⇧B right panel, ⌘J bottom dock (P1), ⌘1..9 tabs, ⌃Tab cycle, ⌘W close tab, ⌘\ split, ⌘⇧J next Needs-you, Enter/Esc on a docked request, ⌘Enter send when the editor is multi-line, ⇧Tab cycles permission mode as in the terminal. All bindings editable.

## 6. Visual identity

Light-first, in Claude's bright style, with a dark theme as the alternate; the mockups under `mockups/` were built dark and approved for structure, so their light rendering is the reference for tokens. Chrome follows Codex density: 13px UI text, 4px spacing base, 6 to 12px radii, muted metadata at 60 percent foreground promoted on hover, thin separators, no heavy cards. Transcript follows Claude's reading comfort: 15 to 16px prose, 1.6 line height, 68 to 72 character measure, headings with clear rhythm, code at 13px monospace. Colors are semantic tokens (surface, surface-raised, foreground, foreground-muted, accent, success, warning, danger, diff-added, diff-removed) so the whole look can be re-skinned. Fonts are tokens too; the mockups use system fonts and the owner chooses.

## 7. Delegated unknowns

Empirical questions the design cannot settle; each has its resolving move and runs first.

1. **Protocol fixture probe**: first pass done. Seven scenarios recorded under `spikes/protocol-probe/fixtures/` with a fixture test file, plus a real subagent transcript and its meta sidecar copied from the probe session so the child-JSONL mapping has a fixture; findings folded into §4.2. Second pass (child C2, first wave, before C3 is specified): unrouted runs of every scenario that touches usage, models or fork; the process-tree memory measurement under the owner's real settings sources; workflow progress frames, rewind, hook callbacks, MCP elicitation and dialog expiry, `perTaskStopAffordance` effect on Stop, `workspaceTrust` attestation and `set_cwd` needs-trust, re-applying session grants through flag settings, resuming a session that is live in a terminal (guard or not), the non-querying user frame after `bash_command`, `claim_session` prewarm, and behaviour with the owner's real settings sources enabled (the first pass ran with empty settings sources and strict MCP).

Replay has two sources that test different code: the JSONL exercises backfill only (it holds no stream events, control requests or progress), while the raw-frame journal and the probe fixtures replay approvals, streaming, queueing and child forwarding. Both are P0.
2. **Terminal spike**: ghostty-web with node-pty under real Claude Code and Codex TUI workloads (alternate screen, synchronized output, CJK and emoji, IME, selection, hyperlinks, scrollback, resize, sustained output). Fallback is xterm.js with WebGL.
3. **Transcript spike**: a long streaming transcript with nested child activity, markdown, code and diagrams, with TanStack Virtual end anchoring; verify that expanding old work never drags the reader back to the stream.
4. **Gateway behaviour**: model discovery and per-session gateway toggling with ClaudeUsage's relay. Confirmed so far: `get_usage` reports no rate-limit windows when routed, which is why the windows come from ClaudeUsage.
5. **Fonts and final tokens**: chosen from the mockups.

## 8. Milestones

Superseded by the cut in §12. The original M0 to M5 sequence was a build order; the children below are the units of ownership, and the waves in §14 are the build order.

## 9. Research index

- `research/codex-thread-ux.md`: transcript, activity grouping state machine, approvals, composer, queue semantics.
- `research/codex-shell-ux.md`: shell geometry, sidebar organisation, pinned summary, subagents panel, composer strip, worktree lifecycle, tokens.
- `research/claude-desktop-ux-and-engine.md`: Claude Code session UI on claude.ai, the 307-method LocalSessions contract, how Desktop spawns and brokers the engine.
- `research/sdk-wire-gap.md`: the complete 2.1.283 wire, the 67-row gap matrix, the four app-side mechanisms.
- `research/landscape.md`: other agent workstations, terminal embedding, rendering libraries, Electron practice, Playwright over a WebContentsView.

---

# Roadmap

The sections below extend the approved design into the composite spec for P0: the cut into children, the contracts that cross them, the ordering, and the record that tracks the unit to its retrospective. Decisions D-1 to D-17 and the verified engine facts in §4.2 are binding everywhere; the grades on the rest are given per child.

## 10. Parent-level acceptance

P0 closes when, on the owner's Mac with the pinned engine, every item below is observed in one sitting:

1. MAWS opens to the Overview showing the owner's existing terminal-started sessions under their projects, with sessions live in a terminal shown as foreign-live.
2. From a project's "+", a session starts in a new worktree with trust attested; project settings, hooks, MCP servers and plugins load as they do in the terminal.
3. From an Overview card, the owner approves a command and answers an AskUserQuestion for a session in another project while an OS notification fires for a third session that needs them; ⌘⇧J lands on it.
4. In one deep session: a subagent's transcript opens in the right panel and receives a message; the Review tool shows the session's diff; a terminal opens in the session's worktree; a file opens in a viewer tab; a file the agent sent renders in Sent files; a workflow shows its phases and agents in Background work.
5. That session resumes afterward from the terminal with `claude --resume`, and a terminal-started session resumes in MAWS.
6. Nine concurrent live sessions stay inside the measured memory budget with the interim never-exit rule, and quitting with turns in flight asks first.
7. A five-hundred-turn transcript stays anchored while old work is expanded, and streaming never drags the reader down.
8. The slash palette opens the model, effort, permissions, usage, context, config, plugins, MCP, sandbox, hooks, memory and skills widgets backed by the engine's reads; `!` and `#` work.
9. Queue, steer, stop and resume behave as labelled; a queued message survives a process exit; a denied command is visible while its group is collapsed; an interrupted session raises "N approvals lost".
10. The light theme is the default and the dark theme switches cleanly.

## 11. Design authority

Binding, because only the joint view could settle them: the purpose and scenes (§1), D-1 to D-17, the process model and launch contract (§4.1, extended by X6), the engine adapter semantics verified by the probe (§4.2), queue ownership, plan outcomes, `!` and `#` semantics and the revisable-log rule (§4.2 "further engine semantics"), the filesystem service rules (§4.3), the memory policy shape and interim rule (§4.4), the broker states (§4.6), the attention model (§5.7), and every cross-child contract in §13. Advisory, a child may overturn with evidence recorded in the Decision Log: library picks (§4.7), the per-surface layouts and copy in §5, the keyboard defaults (§5.8), token values (§6), and the sequencing suggestions inside each child section.

## 12. Children

Level name for every child: "child", dispatched in the waves of §14. Ledgers: a plan child's record is its execution document under `docs/doperpowers/execplans/` plus the subagent-driven-execution ledger; a brief child opens `docs/doperpowers/ledgers/<date>-<child-id>.md`; a spike writes its findings under `spikes/`.

### C1: Foundations — plan

- **Purpose:** the repository everything else builds in: electron-vite scaffold with React 19, the React Compiler and Tailwind v4; the process model skeleton (main, engine-host utility process, PTY host utility process, preload); the validated IPC schema (X2) and the shared types for the event graph and session record (X1) with runtime validators; the theme tokens (X7) light-first with a dark alternate; the test harness (unit tests, an Electron end-to-end smoke test, fixture loading); packaging skeleton for a local unsigned build.
- **Acceptance:** `pnpm dev` opens a window with the three regions and the light theme; the engine host and PTY host start as utility processes and answer a ping over IPC; the PTY host spawns a shell and echoes; X1 and X2 schemas validate the probe fixtures' frames and reject malformed ones in unit tests; the end-to-end smoke test passes in CI-style headless mode; a local build produces an app bundle.
- **Edges:** blocked-by: none. blocks: C3, C4, C5, C6, C9.
- **Contracts:** owns X1, X2, X7; delivers the schema code that X3, X4, X5, X6 extend.
- **Design inheritance:** §4.1 [binding], §4.7 [advisory], §6 [advisory values, binding token names per X7], `mockups/tokens.css` and `tokens-light.css` as the starting token set.
- **Required:** required.
- **Status:** in-flight since 2026-09-28 (execution document being authored; parent pin 32b75d61).

### C2: Protocol probe, second pass — spike

- **Purpose:** turn the remaining engine unknowns into recorded fixtures and findings before the engine host is specified, so C3 and C10 are built on observed behaviour.
- **Acceptance:** fixtures and a findings document covering: every scenario run with `--permission-mode auto` as the default, recording what the classifier emits on allow, escalation and denial (the wire-gap report expects only escalations and denials to be observable), both routed through the gateway and unrouted, with `auto_mode_server_fallback` and `refusal_fallback_prompt` declared in `supportedDialogKinds`, recording whether the server classifier lane refuses through the gateway and what dialog or warning follows; unrouted runs (gateway variables unset) of the usage, models and fork scenarios; the same under the owner's real settings sources with MCP discovery on, including the process-tree memory measurement per session; workflow progress frames from a real Workflow run; rewind; hook callbacks with `--include-hook-events`; MCP elicitation and `request_user_dialog` with dialog expiry set to never; the effect of `perTaskStopAffordance` on Stop with a background task running; `workspaceTrust` attestation and `set_cwd` needs-trust; re-applying session grants through flag settings after a restart; resuming a session that is live in a terminal (guard or not); the non-querying `user` frame after `bash_command`; `--await-claim` and `claim_session`. Each item states what was observed and what the design should do.
- **Edges:** blocked-by: none. blocks: C3, C10.
- **Contracts:** delivers X8 fixtures.
- **Design inheritance:** §4.2 [binding as verified], §7.1 [binding list], `spikes/protocol-probe/harness.mjs` [advisory, extend it].
- **Required:** required.
- **Status:** in-flight since 2026-09-28 (parent pin 32b75d61).

### C3: Engine host — plan

- **Purpose:** the adapter that owns one engine process per session over the raw wire: transport and framing, request ids, cancellation and timeouts, the initialize handshake with hook registration and trust attestation, the control-request surface, the permission broker with its states, the app-owned queue, the process table with the interim never-exit rule, session launch from X6, raw-frame journaling, and normalisation into X1 events.
- **Acceptance:** against the pinned binary: a session starts, streams text and thinking, runs a tool through a permission round trip answered from the host, answers an AskUserQuestion, dispatches subagents whose text arrives attributed by parent, queues a second message and releases it at turn end, steers with priority, interrupts and resumes, exits and is resumed with the queue intact; the broker raises "interrupted, N approvals lost" at exit; every structured read is exposed as a typed call; the journal replays into the same X1 graph in a unit test; conformance tests run against the C2 fixtures.
- **Edges:** blocked-by: C1, C2. blocks: C7, C10, C11.
- **Contracts:** owns X6; produces X1; consumes X8.
- **Design inheritance:** §4.1, §4.2, §4.4 process policy, §4.6 [all binding]; §4.7 stack [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C1, C2.

### C4: Filesystem state, index and replay — plan

- **Purpose:** the durable side of sessions: tailers over the engine's JSONL store with re-anchoring after truncation, sidecar readers with retry, discovery of sessions the app did not start and of their live holders, the SQLite index of app records, the two replay sources (JSONL backfill and raw-frame journal), and the read-only git service (status, branch, diff, log, watcher).
- **Acceptance:** with the owner's real `~/.claude`: every project and session appears with its title, cwd from the first record and holder state; a session live in a terminal is marked foreign-live within two seconds of its process starting; a rewind in the terminal shrinks the transcript in MAWS without a restart; a subagent transcript from the fixtures maps to the X1 graph; replaying a fixture journal and backfilling the same session's JSONL produce one consistent graph; the index survives restart with titles, pins and layout; git status for a dirty worktree updates on file change.
- **Edges:** blocked-by: C1. blocks: C8, C10.
- **Contracts:** owns the replay engine in X8; produces X1; participates in X6 (holder detection informs launch).
- **Design inheritance:** §4.3, §4.4 index scope [binding]; §4.7 [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C1.

### C5: Shell — plan

- **Purpose:** the window the owner lives in: three regions with persisted sizes and accessible resizers, the sidebar (search, Needs-you, pinned, project tree with status glyphs, other sessions, hover cards, priority and recency sort, actions), the Overview board, the tab strip with the single pane and optional split, layout persistence, the keyboard map, OS notifications, the next-needs-you shortcut, quit coordination, theme switching.
- **Acceptance:** driven by fixtures and then by C3 and C4: the sidebar and Overview show nine sessions across three projects with correct glyphs and Needs-you ordering; a hover card previews a read-only tool request and approves by click only; a notification fires for a session entering Needs-you while unfocused and ⌘⇧J opens it; tabs reorder, split and collapse as specified; layout survives restart; foreign-live sessions show holder and no controls; quitting with a running turn asks; every mockup 01 state renders.
- **Edges:** blocked-by: C1. blocks: C8, C10.
- **Contracts:** consumes X1, X2, X4, X7; owns the Overview card layout.
- **Design inheritance:** §5.1, §5.2, §5.7, §5.8 [layouts advisory, attention model and split-focus rule binding]; mockups 01 and 04 vignette 1 [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C1.

### C6: Transcript — plan

- **Purpose:** the presentation model (X3) and its renderer: streaming markdown with math, diagrams and code; user and assistant turns with answer-first work disclosure; activity groups, cells and detail; change receipts; subagent lifecycle and message rows; thinking; plan cards with the three outcomes; answered questions as history; errors and reconnects; boundary rows; time separators; virtualization with anchored reading position. Its first gate is the anchoring spike.
- **Acceptance:** G1 (anchoring spike, required, first): a synthetic five-hundred-turn transcript streams while old work is expanded without moving the reader, at sixty frames per second on the owner's machine. G2: every element of mockup 02 renders from fixture frames; the group state machine matches the classification in X3; a denied action is visible while its group is collapsed and the divider's count jumps to it; a receipt's Undo calls the rewind interface; replayed bash rows render from their tags.
- **Edges:** blocked-by: C1. blocks: C7, C8.
- **Contracts:** owns X3; consumes X1, X7; exposes the renderer for C8's drill-in.
- **Design inheritance:** §5.3 [binding for the element list and the group semantics, advisory for visual details]; `research/codex-thread-ux.md` §2 [advisory]; mockup 02 [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C1.

### C7: Composer and requests — plan

- **Purpose:** how the owner talks to a session: the rich editor with attachments and paste handling, the context strip, the "+" menu, typed `@` context, the slash palette shell (commands from init, skills, custom commands, app actions, marked by origin), queue list with edit, delete and steer, the submit control's five states, `!` and `#` input modes, the request card (X4) in all its placements, the status line and its popovers with the ClaudeUsage read and the engine fallback, the near-limit banner once per window.
- **Acceptance:** with C3 live: sending, queueing, steering, stopping and resuming behave as labelled; a permission replaces the composer and Enter/Esc answer it in the focused pane only; scope options map to the engine's grant kinds and take effect; a question form submits all answers; `!` runs and its output reaches the model's context (or the documented terminal-only fallback); `#` appends to the chosen memory file; ArrowUp recalls history; the status line shows cwd, context, windows, cost and mode; mockup 04 vignettes 2 to 5 render.
- **Edges:** blocked-by: C1, C3, C6. blocks: C11.
- **Contracts:** owns X4; consumes X1, X2, X3, X6.
- **Design inheritance:** §5.4, §5.5 [binding for semantics, advisory for layout]; §4.2 queue and `!`/`#` [binding]; mockup 04 [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C1, C3, C6.

### C8: Right panel tools — decomposing at dispatch

- **Purpose:** the auxiliary panel: the host with per-session tabs, pin, maximize and the "+" menu (X5); the pinned summary as the resting state; and the tools Subagents (lists, drill-in with the C6 renderer over child transcripts, message a child), Review (session diff with file navigation), Files (tree and viewer tabs), Sent files (renderers per type), Background work (shells, monitors, task lists, workflows with phases and agents, stop), Session info.
- **Acceptance:** coarse until its own cut: every state of mockup 03 renders from live sessions; pinned tabs persist across sessions; each pinned-summary row opens its tool; a child receives a message from the drill-in; Review opens a file tab at the changed line.
- **Edges:** blocked-by: C4, C5, C6. blocks: C10 (attach affordance), C12.
- **Contracts:** owns X5; consumes X1, X3.
- **Design inheritance:** §5.6 [binding for the tool list and the per-session-with-pin rule, advisory for layout]; `research/codex-shell-ux.md` §3 [advisory]; mockup 03 [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C4, C5, C6.

### C9: Terminal — plan

- **Purpose:** a real terminal in the session's worktree: the PTY host service (lifecycle, resize, backpressure), the renderer adapter with ghostty-web first and xterm.js with WebGL as the fallback, decided by its spike gate; the Terminal tool registered into X5; the worktree identity warning.
- **Acceptance:** G1 (spike, required, first): ghostty-web under the acceptance list in §7.2 (both TUIs, alternate screen, synchronized output, CJK and emoji, IME, selection and copy, hyperlinks, scrollback, resize and reflow, sustained output, sleep and resume); a failed item switches the adapter to xterm.js and records why. G2: a terminal opens in the session's cwd, survives switching sessions when pinned, warns when the session moved worktree and offers a new terminal, closes with confirmation when a command is running.
- **Edges:** blocked-by: C1. blocks: C10.
- **Contracts:** implements X5; owns the PTY IPC subset of X2.
- **Design inheritance:** §5.6 Terminal [binding for behaviour], §7.2 [binding acceptance list], `research/landscape.md` Part B [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C1.

### C10: Sessions, worktrees and trust — plan

- **Purpose:** the session lifecycle end to end: the new-session sheet (location, worktree new or existing, branch, model and effort, permission mode, additional directories), the trust step and attestation, worktree create, reuse and cleanup under the engine's convention, fork in place and fork to a new worktree with transcript copy and rollback, rename with provenance, archive, delete conversation, foreign-live behaviour with "attach in a terminal tab" for background jobs, and the grant snapshot hook for later re-application.
- **Acceptance:** each path in §3 "Sessions" works against the real engine and the owner's repositories; a never-trusted directory prompts once and then loads project settings exactly as the terminal does (compared by the init frame); a fork to a new worktree produces a session that resumes from the terminal; cleanup distinguishes archive, remove clean checkout, discard changes, delete branch; a `--bg` job attaches in a terminal tab.
- **Edges:** blocked-by: C3, C4, C5, C9. blocks: C12.
- **Contracts:** extends X6 with trust and worktree fields; consumes X2, X5.
- **Design inheritance:** §3 Sessions, §4.5, §5.1 new-session sheet, D-12 [binding]; `research/claude-desktop-ux-and-engine.md` B7, B8 [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C3, C4, C5, C9.

### C11: Palette widgets, settings, gateway and usage — plan

- **Purpose:** the terminal's menu commands as widgets over the transcript, backed by the engine's reads and controls: model and effort (with gateway models and fast mode), permissions and rules, usage and context, config, plugins with reload, MCP status and reconnect, sandbox, hooks, memory, skills, agents, status, compact, rename, resume, export, diff; the settings screens (engine path and version, gateway toggle, keyboard map, theme, notification policy); the ClaudeUsage integration for windows and accounts.
- **Acceptance:** every widget listed opens from the palette and shows live engine data; changes made in a widget are reflected by the next init frame or read; switching the gateway restarts the session with a visible notice; usage windows match ClaudeUsage's panel.
- **Edges:** blocked-by: C3, C7. blocks: C12.
- **Contracts:** consumes X2, X4, X6.
- **Design inheritance:** §3 palette list, §5.4 palette, §5.5, D-7, D-17 [binding for the list and sources, advisory for layout]; the owner's screenshots of the terminal's menus in the vault note [advisory].
- **Required:** required.
- **Status:** not-dispatched, blocked-by C3, C7.

### C12: Finish — decomposing at dispatch

- **Purpose:** what makes P0 a daily driver: the memory budget policy with grant snapshots and re-application, the prewarmed spare session, split-pane polish, keyboard map editing, packaging with signing and notarization for internal distribution, the updater with restart coordination, and the recomposition run against §10.
- **Acceptance:** coarse until its own cut; closes with §10 verified in one sitting.
- **Edges:** blocked-by: C8, C10, C11. blocks: none.
- **Contracts:** consumes all.
- **Design inheritance:** §4.4 policy [binding shape], §3 P0 packaging line, `research/landscape.md` Part D [advisory].
- **Required:** required.
- **Status:** not-dispatched, deliberately late.

## 13. Cross-child contracts

- **X1 Event graph and session record** (owner C1 for the types; C3 and C4 produce; everyone consumes). Identifiers kept distinct and never flattened: session id, message uuid, API message id, tool-use id, task id, agent id, parent tool-use id, request id. Normalised event kinds: session lifecycle, turn lifecycle, assistant block delta and complete, user message (with replay and bash tags), tool use, tool result (with spill path), tool progress, permission request and resolution, question request and answer, plan request and outcome, dialog and elicitation, subagent lifecycle and message, task lifecycle and notification, workflow progress, compaction and reset and retraction boundaries, usage and context sample, error and reconnect, process exit. Session record: app id, engine session id, project id, directory (from the first record), worktree and branch, title with source (user, generated, tool), pin, archive state, holder (self, terminal pid, background job, none), last-seen cursor, unread flag, engine version, gateway state, model and effort, permission mode as requested and as effective with the refusal code when they differ. Attention item: id, session id, kind (permission, question, plan, dialog, elicitation, auto-mode unavailable, error, interrupted, held peer message), request reference, created at, state (pending, delivered, confirmed, retired). Denial kinds travel on tool results (`user-rejected`, `permission-rule`, `automode-blocked`, `automode-unavailable`, `automode-parsing-error`, `interrupted`, `cancelled`): `automode-blocked` is informational and counts in the turn divider and its cell as "auto-denied"; `automode-unavailable` stops the turn and is the Needs-you kind above, whose remedy is switching out of auto mode; allow verdicts are not attributable, so no cell ever says "auto-approved". Binding: without one graph the transcript, the panels and the attention model would each invent their own keys.
- **X2 IPC schema** (owner C1). Namespaced commands and events with runtime validation on both sides: `session.*`, `engine.*`, `fs.*`, `git.*`, `pty.*`, `layout.*`, `attention.*`, `settings.*`. The renderer never receives shell, git or engine handles. Binding: the security boundary and every child's integration surface.
- **X3 Presentation model** (owner C6). Row types: time separator, user, assistant text, work divider, activity group, cell, cell detail, change receipt, subagent row, agent message row, thinking, plan, question (historical), request card slot, error, boundary, replayed bash. Each tool event carries at derivation time: groupable or standalone, category in the fixed summary order (MCP sources, loaded skills, file changes, exploration, commands, web), denial marker with its denial kind, subagent lifecycle kind, group-start marker. Binding: C7's cards and C8's drill-in render the same rows.
- **X4 Request card** (owner C7). One component for permission, question, plan, dialog and elicitation, taking an X1 attention item and an answer callback, placed docked at the composer, in an Overview card, in a hover card (read-only tools, click only), and inline. Binding: the same decision must look and behave identically wherever it appears.
- **X5 Panel host and tool registry** (owner C8; C9 implements). A tool declares id, title, icon, pinnable, per-session state factory and render; the host owns tab order, pin, maximize and the "+" menu. Binding: tools land in different waves.
- **X6 Launch contract** (owner C3; C10 extends). Absolute binary path, the flag set of §4.1, the constructed environment allowlist, initialize fields (hooks, `perTaskStopAffordance`, `supportedDialogKinds` listing at least `auto_mode_server_fallback` and `refusal_fallback_prompt`, `workspaceTrust`), flag settings (dialog expiry, re-applied grants), resume and fork flags. The initialize response's `current_permission_mode` and each `system/init` frame's permission mode are the effective mode; `set_permission_mode` refusals carry a code (`auto_mode_settings`, `auto_mode_circuit_breaker`, `auto_mode_fast_mode`, `auto_mode_model`, `auto_mode_unavailable`) the UI must surface. Binding: verified behaviour depends on the exact set, and auto mode routed through the gateway is the owner's mainline path.
- **X7 Theme tokens** (owner C1). The token names in `mockups/tokens.css`, light-first values from `tokens-light.css`, dark alternate; components use tokens only. Binding names, advisory values.
- **X8 Fixtures and replay** (C2 delivers; C4 owns the engine). Fixture format is the probe's journal: one JSON object per line with sequence, direction, timestamp and frame; a scenario is a file; sidecars sit beside it. Replay feeds either the raw journal (C3's normaliser) or a JSONL transcript (C4's backfill). Binding: tests across children depend on it.

## 14. Ordering and dependency map

- Wave 1, now: C1 and C2 in parallel.
- Wave 2, after C1 (and C2 for C3): C3, C4, C5, C6, C9 in parallel. C5 and C6 build on fixtures until C3 and C4 land.
- Wave 3: C7 (after C3, C6) and C8 (after C4, C5, C6) in parallel.
- Wave 4: C10 (after C3, C4, C5, C9) and C11 (after C3, C7) in parallel.
- Wave 5: C12, then recomposition against §10.

Forced sequence: the fixtures gate the engine host; the transcript gates the composer's cards and the panel's drill-in; the terminal gates the attach affordance. Everything else is parallel by construction because the contracts in §13 are fixed here.

## 15. Risks and mitigations

- The wire changes under us with a new Claude Code release: the engine is pinned per session and the conformance tests (C3) run against fixtures; upgrading is a deliberate re-probe (C2's harness stays).
- Real settings make processes far heavier than the bare probe: C2 measures the tree; the interim never-exit rule keeps behaviour predictable until C12's budget.
- Foreign-live detection races a terminal start: C4 marks by holder file and process liveness, and C10 refuses to resume a session whose holder is alive.
- ghostty-web fails the acceptance list: C9's spike gate switches to xterm.js without touching the tool.
- Scene A drowns Scene B or the reverse: §10 requires both in one sitting; C5 and C7 are separate children so neither is starved.
- The transcript renderer is rebuilt when grouping lands: X3 freezes the classification fields before any renderer exists.

## 16. Deferred and out of scope

Deferred (may return): everything in §3 P1 and P2; the extension model of D-9; the detachable supervisor (D-16); the all-accounts usage view; dictation; the bottom dock; the topology view for subagents; the replay scrubber; workflow pause, skip and retry if the engine ever exposes them; per-message approval of held peer messages (needs an engine change).

Explicitly out of scope for P0: bundle patches (D-1); Windows and Linux (D-11); a second engine (D-7); reproducing the 307-method Desktop contract (the design keeps only the essential workstation architecture); cloud sessions, sharing and remote control.

## 17. Tracking map

| Child | Grain | Status | Ledger / artifact |
|---|---|---|---|
| C1 Foundations | plan | in-flight (2026-09-28, pin 32b75d61) | `docs/doperpowers/execplans/2026-09-28-c1-foundations.md` (authoring) |
| C2 Probe, second pass | spike | in-flight (2026-09-28, pin 32b75d61) | `spikes/protocol-probe/findings-pass2.md`, `fixtures/pass2/` |
| C3 Engine host | plan | blocked-by C1, C2 | |
| C4 Filesystem state, index, replay | plan | blocked-by C1 | |
| C5 Shell | plan | blocked-by C1 | |
| C6 Transcript | plan | blocked-by C1 | |
| C7 Composer and requests | plan | blocked-by C1, C3, C6 | |
| C8 Right panel tools | decomposing | blocked-by C4, C5, C6 | |
| C9 Terminal | plan | blocked-by C1 | |
| C10 Sessions, worktrees, trust | plan | blocked-by C3, C4, C5, C9 | |
| C11 Palette, settings, gateway, usage | plan | blocked-by C3, C7 | |
| C12 Finish | decomposing | deliberately late | |

## 18. Surprises and discoveries

- 2026-09-28, probe: AskUserQuestion travels over the permission channel; `fork_conversation` is unsupported (routed); resume does not replay history; child agents stream per message only; the project slug is the realpath; every first-pass scenario ran routed through the gateway because the shell exports the gateway variables.
- 2026-09-28, research: Codex's center tabs are one chat plus its content tabs, not multiple conversations; MAWS's multi-session tabs are an intentional extension. `inline-composer` in Codex is an image-edit prompt. Claude Desktop's `LocalSessions` has 307 methods and no IPC stores; Desktop is an SDK client with a large app-side layer.
- 2026-09-28, critique: session-scoped grants are not persisted for local sessions; there is no acknowledgement frame for a control response; print mode leaves project-scoped grants gated without a trust record; `perTaskStopAffordance` absent makes Stop kill background agents.

## 19. Decision log

- 2026-09-28: Verification call for this composite: each plan child ends with an independent review at the astra rung (reviewer-medium by default, reviewer-high for C3 and C4); the parent closes by recomposition against §10 with a scale review of the integrated app. Alternative rejected: per-child review only, which would miss the seams §10 exists to test.
- 2026-09-28: Cut into twelve children rather than six or the original six milestones; reason: ownership and verification seams (live wire versus disk, shell versus transcript versus composer, terminal's own spike), with C8 and C12 left coarse for the frontier rule. Owner approved.
- 2026-09-28: Tracking by this map plus ledgers, no ticket board; execution of wave 1 by plan-executor subagents from the architect session; model routing for executors prefers opus and fable unless astra-high fits; reviewers always astra. Owner decided.
- 2026-09-28: Critique round 1 adopted in full except finding 14 (usage placement kept per D-17); round 2 wording holds adopted in full. Rejected alternative in round 2: a fixed idle timer for process exit, replaced by the interim never-exit rule.
- 2026-09-28: D-18 recorded: auto mode default, few prompts expected; consequence: C2 runs in auto mode, C7's card and the hover card remain but the Overview and Needs-you copy assume questions and escalations. Owner's note.
- 2026-09-28: D-18 follow-up from the critic adopted: X6 lists the dialog kinds and the auto-mode refusal codes; X1 carries requested versus effective permission mode and an auto-mode-unavailable attention kind; denial kinds are distinguished (auto-denied counts in the divider, auto-mode unavailable is Needs-you); C2 probes auto mode routed and unrouted. Flags C1 (X1 types) and C2 (scope), both in flight and notified.
- 2026-09-28: Model override pass-through: the owner's `ANTHROPIC_DEFAULT_*_MODEL` variables are passed to the engine when present, shown in Session info; alternative rejected: stripping them, which would make "opus" mean something different from the terminal.

## 20. Outcomes and retrospective

Pending. Closing is a recomposition check against §10, then the retrospective.
