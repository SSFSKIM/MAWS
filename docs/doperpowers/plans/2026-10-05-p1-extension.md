# P1 — The extension phase (2026-10-05)

> **Parent:** `docs/charter.md`, the root spec; this document is its child at level **P1** (charter §3 "P1", §3 "P2" foundation, D-9's agent-facing remainder, §16's deferred list). Parent pin: git blob `1844b009aa55e32a352f2d1801107c6471b6484e` of `docs/charter.md` as amended 2026-10-05 (§3 P1 and P2, D-9, D-16, §19 "P1 design approved", §20 written). Children of this document cite it by path, child id and this document's own pin at their dispatch.

Status: design approved by the owner on 2026-10-05 after three grill rounds ("Approve as presented"); routed to decomposing, which extends this document in place with the roadmap sections (children, contracts, ordering, tracking, record). Nothing is built before the cut is approved. Decisions marked **P-n** were made with the owner in the brainstorming rounds; decisions marked **A-n** are the architect's and can be overridden.

## 1. Purpose

**Higher purpose.** MAWS is a general workstation for supervising Claude Code agents, built to the baseline of three reference apps (Codex desktop for UX quality, Claude Desktop for engine integration, T3 Code for source readability) and then past it, with the owner's own workflows arriving as plugins on a strong base (charter §1, D-5, D-20). P0 reached the baseline and closed on daily use (charter §20).

**What this phase is for.** MAWS becomes the owner's whole workstation. Everything the agent workflow needs that today lives in a terminal moves into the app, and the agent gains a surface to reach the GUI: tools it can call, places it can put things, a channel through which the human answers in place. Inside that, the move past the baseline: human and agent share the same surfaces (a browser, delivered files and artifacts, later documents), with comments pinned to things as the feedback channel, and orchestration (workflows, subagents, cross-session messages) is visible.

**The measure (P-3).** "The GUI is good enough that nothing in my workflow sends me to a terminal." The owner named what still did at the start of this phase: live workflow progress, plugin and marketplace management, voice, editing a file by hand. The ptc kernel and background jobs do not. The sminos family chat is a later integration, not this phase's measure.

**What it must not be.** Not a dependency on claude.ai's services: the co-work layer is MAWS's own and local-first ("We'll build our own for these", P-4). Not a second plugin API: the display surface stays the engine's `ui_surface_v1` (D-9); MAWS adds tools the agent can call, which is the in-process MCP server D-9 always named. Not a browser or an IDE as products: the browser and the editor serve the session.

## 2. Acceptance

P1 closes when, on the owner's Mac with the installed engine, every item below is observed in one sitting. Items are observable behaviour; the children's acceptance refines them.

1. A Workflow run shows live in the panel widget, phases on the left and agents on the right with model names. Clicking an agent opens its transcript. Stop and resume work. The subagent topology tree shows nested agents with running and done states.
2. From MAWS the owner adds a marketplace, installs, updates, enables and disables a plugin, and reloads mods. The running session reflects it.
3. The owner holds a key, speaks, and the text lands in the composer.
4. The owner edits a file in a MAWS tab and saves. A conflict opens the merge view.
5. The agent delivers a file through MAWS's tool. It appears as a row and opens in the viewer: PDF, HTML, image, video, audio, markdown. Artifacts keep versions.
6. The owner pins a comment to an element in the in-app browser or in a delivered artifact. A side thread opens, the agent edits and replies there, the main conversation is not interrupted. "Send to main" works.
7. The in-app browser imports a Chrome profile the owner chooses. The agent drives a tab through MAWS's browser tools. The owner takes over by clicking, and the agent resumes after.
8. The agent asks a batch question through MAWS's tool. A capsule in the transcript opens the sheet in the panel with choices, free text, files, a repository, a design system and "decide for me". An async question does not block the turn.
9. The owner quits MAWS with a turn in flight and relaunches. The session is still there and still streaming.
10. `/btw` opens a side pane with the answer; the main conversation is untouched.
11. From the panel the owner stages, commits, pushes and opens a PR from the session's worktree. The summary row shows PR state and checks.
12. The Tasks panel edits a task list. Cross-session messages show as rows and can be answered.
13. The three gaps carried from P0 close in recomposition: the panel and reference taste sitting (C8-S), the native terminal hands (C9), the scale review of the integrated app (S).

## 3. Design

Three primitives are shared by most of the work and are the reason this phase was designed as a whole before it is cut: the tool server (A), the deliverables store and viewer (B), and anchored messages with side threads (C). The surfaces D to I build on them.

### A. The MAWS tool server (the spine)

One SDK-hosted MCP server named `maws`, declared in the initialize handshake (`initialize.sdkMcpServers`, SPEC 45 §45.21 of the engine library) for every MAWS-launched session and served from the engine host over the protocol's `mcp_message` round trip. This is how Claude Desktop builds every one of its extensions (its `ccd_pr`, `ccd_view.show_pane`, `preview_*`, scheduled-task and local artifact tools are all host MCP servers; `docs/doperpowers/evidence/extension-2026-10-05/claude-desktop-extensions.txt`). Codex does the same over native pipes.

- **Tools in this phase:** `send_file` (files, caption, urgency; replaces the engine's SendUserFile, which is gated to Desktop entrypoints, SPEC 23 §23.4.2); `ask` (a question sheet: questions with modalities, each a choice set, free text, files, a repository, a design system or "decide for me"; `blocking: true | false`; the result is the answers or, for an async ask, an acknowledgement with the answers delivered later as a user message); `show_pane` (open a panel tool: diff, file, terminal, tasks, browser, deliverable); the browser tools (D); `artifact_create`, `artifact_update`, `artifact_list` (B). PR binding and scheduling tools wait for the next composite.
- **Data flow:** a tool call arrives in the engine host as an MCP request; the host emits an X1 event the renderer draws as a row (a capsule for `ask`, a delivery row for `send_file`, a browser action row); the surface answers through IPC; the host returns the MCP result. Fire-and-forget tools answer at once.
- **Terminal interop (D-12):** a session resumed in the terminal lacks these tools and nothing breaks: each tool's description names its fallback (Write a file and name its path; AskUserQuestion; describe where to look). A session started in the terminal and taken over by MAWS gains them at the next launch only (the engine adds SDK servers at initialize and through `mcp_set_servers`; the child grounds whether the latter suffices mid-session).
- **Contract X9 (binding once the cut lands):** the server name, tool names, input and output schemas, and the row each tool produces. The owner's skills and plugins may target `mcp__maws__*` names; they do not change without a dated Decision Log entry here.
- **Permissions:** tool calls run under the session's permission mode like any MCP tool; `ask` and `send_file` are read-only and concurrency-safe; browser actions that navigate or act are not.

### B. Deliverables and the viewer

A per-session record of what the agent delivered: files (`send_file`), artifacts with versions, screenshots the browser tools took. The record points at delivered files in place and copies only artifact versions, under the app's data directory.

- **Panel tool "Deliverables"** (the vault's "Context"): the list, newest first, grouped by kind; a row opens the viewer; a back control returns to the list (the vault's Cowork-like flow).
- **The viewer**, in the panel by default and in a main tab on demand: sandboxed frames for PDF and HTML (no network by default; a content-security policy that blocks scripts' egress; later, declared connectors as Claude Desktop's `window.cowork.callMcpTool` allows), native players for video and audio, images inline, the existing read-only viewer for markdown and code. "Open externally" and "Reveal in Finder" always.
- **Artifacts:** a self-contained HTML file the agent writes, then registers with `artifact_create {id, html_path, title}`; `artifact_update` adds a version; MAWS keeps versions and metadata, draws the artifact in the viewer, can screenshot it for the agent, and surfaces its console errors (Claude Desktop's local artifact model, local-first already). Imported or shared artifacts are out of scope.
- **Transcript:** every delivery and artifact version is a row (C6's `SendUserFile` cell row is replaced by this row); the row opens the viewer.
- **The next composite** (docs, slides and design editors, the design system) builds on this store: a document is a deliverable kind with an editor instead of a viewer.

### C. Anchored messages and side threads

An **anchor** names what a message is about: `{ kind: 'browser-element' | 'artifact-element' | 'file-line' | 'pr-line' | 'none', locator, label, pageUrl?, screenshot? }`. Comment mode in the browser (D) and in the artifact viewer (B), a line gutter in the editor (F) and a PR line (F) produce anchors; the comment composer attaches to one.

- **Default destination, the side thread (P-6):** a child session forked from the parent at the current point (C10's fork path; the engine's `fork_conversation` request is probed first, §4), marked in its record as a side thread of the parent with the anchor; shown in a side pane with its own composer; able to edit (it carries the parent's permissions and directory); its outcome summarised back into the main transcript as a MAWS row ("Side thread on <label> finished: …") with a link to the thread. Side threads list in the panel and in the sidebar under their parent.
- **"Send to main":** the comment goes to the main session as a steer at the next tool boundary with the anchor serialised as context (text plus the screenshot as an image block).
- **`/btw`:** the engine's own `side_question` control request (SPEC 45; the slash command routes to it); drawn in the same side pane; no new process. A side question that becomes work is promoted to a side thread.
- One mechanism serves comments on artifacts, comments on web pages, review comments on code and the quick side question; the destination is the one product choice, made once (P-6).

### D. The in-app browser

Browser tabs as a panel tool and as main tabs: a `WebContentsView` per tab with Codex's navigation chrome (back, forward, reload, address, open externally, inspect) and its load-error and zoom states (`codex-extensions.txt` §1). Owned by the main process; one browser session partition per imported profile, one default partition otherwise.

- **Comment mode:** the pointer selects an element, an area or several; the overlay adds a comment and a cropped screenshot; the anchor's locator is the element's accessibility path and a CSS selector; the submission is an anchored message (C). The page is told nothing unless it declares annotation support; a page-suggested prompt is attributed as such.
- **Chrome profile import (P-7, owner's note):** the user picks a Chrome profile; MAWS copies cookies and history from its on-disk stores, decrypts saved passwords with Chrome's Safe Storage key after one Keychain consent, and loads the profile's extensions where Electron supports them, each category opt-in and reported ("N cookies, M passwords, K extensions, J skipped: unsupported"). The import is a copy; Chrome is never driven or modified. A spike precedes the design (§4).
- **Agent control, MAWS's own (P-5):** browser tools on the spine, built on Playwright over CDP against our own view (`playwright-core` connected to the view's debugger, or the CDP protocol directly): `browser_tabs`, `browser_navigate`, `browser_snapshot` (an accessibility snapshot with element refs, the same refs comment mode uses), `browser_act` (click, fill, select, press by ref or locator), `browser_eval` (read-only by policy), `browser_screenshot`. Each action is a row with the tab and the target; the human sees the agent's cursor and the acting tab.
- **Takeover:** the human clicking into the page pauses agent actions on that tab; the agent's next action waits with a visible "You have the page" state and resumes when the human stops for a moment or clicks "Hand back". No input arbitration beyond this in P1.
- cua stays for native apps and for the owner's real Chrome through its own browser surface; its planned Phase D adapter to a MAWS browser is not needed (A-7), and the cua repository's backlog is told so.

### E. Orchestration views

- **The workflow widget** (the vault's design): a Workflow run opens from Background work into a widget with phases on the left, agents on the right with model names and states; click an agent for its transcript (C8b's drill-in); stop, and resume where the engine allows (`perTaskStopAffordance`).
- **The topology tree:** nested subagents under their parents with running and done states, done agents folded under their parent, click for the transcript; replaces the flat Subagents list's resting state.
- **Cross-session messages:** `SendMessage` and inbox rows draw with sender and recipient, and a reply composer answers from the row; `ListAgents` results draw as a list. Teams (SPEC 39) draw as teammates under the lead. The sminos family chat integration is deferred.
- **Tasks panel:** the read-only checklist becomes an editable list (create, update status, reorder) through the engine's task tools or the task files it reads (SPEC 20 §20.2.3); the child grounds which.
- **Scheduled loops:** listed where the engine exposes them (CronCreate records, SPEC 22); a routines editor is deferred.

### F. Editor and source control

- **Editor:** CodeMirror 6 editing in file tabs (the read-only viewer is its base), save with stale-content detection (hash on read, compare on write, as Claude Desktop's `writeSessionFile`), the merge view for conflicts, a line gutter that produces anchors (C).
- **Source control panel:** status, stage and unstage, discard with confirmation, commit with message, push, open a PR through the GitHub CLI when present; branch and upstream shown; PR state and checks join the summary row (C8's push-state row). Mutations run through C4's git service with the same trust gate; nothing runs `core.fsmonitor` before trust.

### G. Plugins, marketplaces and mods

Claude Desktop's model (`claude-desktop-extensions.txt` §8): marketplaces added, removed and refreshed; plugins installed, updated, uninstalled, enabled and disabled; mods reloaded through the engine's `reload_plugins` request; skills through `reload_skills`. The palette's `/plugins` widget grows into this surface. First grounding question for the child: whether installs and enables go through the engine's CLI (`claude plugin …`) in a MAWS-owned process or through announced settings writes; the standing rule holds either way: no user settings written silently, every write named and confirmed.

### H. Voice

Push-to-talk dictation into the composer: hold a bound key, speak, release, the text lands at the caret. Local Apple speech recognition first (A-8), through a small Swift helper the app bundles; the microphone permission is requested on first use with the reason stated. Realtime voice conversation is deferred.

### I. The detachable supervisor

The engine host leaves the app's utility process for a detached supervisor process the app reaches over a Unix socket under the app's data directory, so sessions outlive app restarts and updates (D-16 amended). The app starts the supervisor if absent, reconnects at launch, and the transcript catches up from the host's event stream and the disk. Quit offers "Quit and keep sessions running" beside the existing busy report; the supervisor exits itself when it holds no session. The memory budget (charter §4.4) moves with the host. Terminal interop is unchanged: the supervisor is one more holder in the registry.

## 4. Delegated unknowns (spikes before the cut binds them)

Each is a findings-only spike recorded under `spikes/` with fixtures where the engine is involved; none merges product code.

- **S1 Chrome profile import on Electron:** cookies and history from the profile's stores; saved passwords through the Safe Storage key with one Keychain consent; which extension kinds Electron loads. Deliverable: what imports, what does not, and the consent and copy surface.
- **S2 Playwright over CDP against a WebContentsView:** connect, snapshot with refs, act, screenshot; element refs shared with comment mode; the cost of keeping the debugger attached.
- **S3 The SDK MCP round trip under MAWS's launch:** a `maws` server with one tool, declared at initialize, called by the model, its result drawn; `mcp_set_servers` mid-session; recorded as `spikes/protocol-probe/fixtures/pass3/sdk-mcp-*` on the installed engine.
- **S4 Fork and side-question shapes:** `fork_conversation` and `side_question` on the installed engine (both have no published schema); whether a fork can start a side thread without a new launch; fixtures recorded.

## 5. Ordering (advisory; decomposing fixes the edges)

The spine (A) first, with S3. Deliverables (B) and anchored messages (C) after A, with S4 for C. The browser (D) after S1 and S2, and after C for comment mode. Orchestration (E), editor and source control (F), plugins (G), voice (H) and the supervisor (I) are independent of each other and of A. A finish child closes §2 item 13 and runs recomposition against §2.

## 6. Deferred (the composite after this one)

The docs, slides and design editors and the design system (on B's store); the sminos family chat integration; a PR inbox; a routines editor; the prewarmed spare session; realtime voice; a Spaces-like organiser of deliverables across sessions; plugin JavaScript modules on the engine surface; remote control; the replay scrubber; the all-accounts usage view (likely already met by the usage pill's popover; verify at recomposition).

## 7. Decision log

| # | Decision | Reason |
|---|---|---|
| P-1 | Scope: charter §3 P1 plus D-9's agent-facing remainder, as one composite; the co-work layer's foundation (B, C) is in, its editors are the next composite. | Owner, 2026-10-05, rounds one and two. The foundation shares surfaces with sent files; the editors do not need to be designed now. |
| P-2 | P0 closed on daily use, no further sitting; §20 written from the recomposition record; the three gaps carried here (§2 item 13). | Owner, 2026-10-05 ("Declare closed on daily use"). |
| P-3 | The measure: nothing in the owner's workflow sends them to a terminal; the start-of-phase list is workflow progress, plugin and marketplace management, voice, editing a file by hand. | Owner, 2026-10-05: "none send me to terminal if desktop GUI is good enough. no PTC, --bg. sminos family is what we'll integrate with App later on." |
| P-4 | The co-work layer is MAWS's own and local-first; Codex's Spaces and artifact surfaces are the UX reference, Claude Desktop's host-MCP pattern the integration reference; claude.ai's Artifact, Docs and Cowork services are not used. | Owner, 2026-10-05: "We'll build our own for these. … Reason I took notes on claude docs is to make our equivalent of them, not necessarily to use theirs." The engine's Artifact and SendUserFile tools are gated to a first-party provider and Desktop entrypoints (SPEC 44 §44.3.2, SPEC 23 §23.4.2). |
| P-5 | The in-app browser is MAWS's: Codex's view, comment mode and Chrome profile import, driven by MAWS's own browser tools over CDP; cua stays for native apps and real Chrome. | Owner, 2026-10-05: "we can build OpenAI's browser service ourselves, not use theirs." |
| P-6 | A pinned comment opens a side thread by default (a child forked from the parent); "Send to main" is the alternative. | Owner, 2026-10-05, round two; the vault's "let the comment section be forked session, so doesn't interrupt the main conversation". |
| P-7 | The in-app browser imports a Chrome profile: cookies, credentials, extensions, as Codex does. | Owner's note, 2026-10-05. |
| P-8 | The detachable supervisor is in this phase; the prewarmed spare is out. | Owner, 2026-10-05, round two. |
| P-9 | The full workflow widget and the subagent topology tree are in. | Owner, 2026-10-05, round three. |
| P-10 | Plugin and marketplace management is built, on Claude Desktop's model. | Owner, 2026-10-05: "the implementation already is in Claude Desktop". |
| A-1 | The tool server is named `maws`; tool names and schemas are contract X9. | One stable namespace the owner's skills can target. |
| A-2 | The viewer opens in the panel by default and in a main tab on demand. | The vault's Cowork-like flow; the main tab for depth. |
| A-3 | Artifact versions live under the app's data directory; delivered files are referenced in place. | Copying every delivered file would duplicate the worktree; artifacts need history. |
| A-4 | Side threads use the engine's fork path C10 built, after S4 decides between the launch flag and `fork_conversation`. | No second session model. |
| A-5 | `/btw` uses the engine's `side_question` request. | The engine already serves it; no process per question. |
| A-6 | Dictation uses local Apple speech recognition through a bundled Swift helper. | No cloud dependency; Claude Desktop's gateway credential path is not available to MAWS. Advisory. |
| A-7 | cua's Phase D adapter is not needed for MAWS's browser; the cua backlog is told. | P-5 makes the browser tools MAWS's own. |
| A-8 | Spikes S1 to S4 run before the children they inform are cut. | The vendor contracts and engine schemas involved are unpublished or unverified. |

## 8. References

- Charter: §1, §3 P1 and P2, D-5, D-9, D-12, D-16, D-20, §16, §19 entries of 2026-10-05, §20.
- Reference inventories (2026-10-05, static source): `docs/doperpowers/evidence/extension-2026-10-05/codex-extensions.txt` (browser and annotations §1, MCP apps §3, plugins §4, PRs §5, automations §6, artifacts and Spaces §7), `claude-desktop-extensions.txt` (side chats §1, delivered files §2, artifacts §3, Launch §4, PRs §5, routines §6, plugins §8, voice §11a).
- Engine spec library, 2.1.287 (`~/claude-code-bundle/2.1.287/SPEC/`): 45 §45.21 `mcp_message` and `initialize.sdkMcpServers`; 45 control table (`side_question`, `fork_conversation`, `mcp_set_servers`, `reload_plugins`, `reload_skills`, `register_repo_root`); 23 §23.4.2 SendUserFile gates; 44 §44.1 and §44.3.2 Artifact gates; 21 AskUserQuestion previews and multi-select; 20 tasks; 22 scheduling; 38 and 39 messaging and teams; 46 Claude in Chrome; 43 voice. The installed engine is 2.1.289; every wire claim is re-probed before it binds.
- The owner's notes: `~/Documents/Claude Architect Cert/Claude Architect Vault/WorkStation Design/To build like actual dope Agent Workspace.md` (the right panel, batch and async questions, workflow widget, topology) and `Claude Docs study — Enriching Side Panel (currently deferred Phase 2).md` (comments as the channel, the forked comment thread, annotation mode, Chrome profile import, Codex's browser as the model).
- cua: `/Users/new/Developer/GitHub/cua/README.md` ("Chrome (browser surface)", "For MAWS"), `docs/doperpowers/specs/2026-10-02-standalone-cua-design.md` (Phase D).
- Prior MAWS research: `research/codex-shell-ux.md` §7 and §8, `research/claude-desktop-ux-and-engine.md` A8 and B1, `research/codex-computer-use/README.md` §8 and §11, `research/landscape.md` "Ten UX ideas" item 7.
