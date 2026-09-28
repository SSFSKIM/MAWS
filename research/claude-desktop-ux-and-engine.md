# Claude Desktop UX and Claude Code engine study

**Target:** Claude Desktop macOS 2.9939.2; claude.ai web bundle captured 2026-09-25. **Research date:** 2026-09-28. **Purpose:** inform MAWS, a local-first Electron AI-agent workstation driven by Claude Code, with project/session navigation, browser-like middle tabs, and auxiliary terminal/topology/diff/files/browser/source-control/side-chat panels.

## Evidence and citation conventions

This is static-source research, not live-app observation. A component’s presence proves that its rendering path and strings exist, not that every account sees it. Feature flags, account capabilities, organization policy, and local/cloud/SSH execution paths materially change availability. Scroll feel, streaming cadence, animation quality, and restart persistence were not tested interactively.

Source roots, used by basename citations below:

- Main-process/preload files: `/Users/new/claude-desktop-re/app-2.9939.2/.vite/build/`.
- Web JS/CSS files: `/Users/new/claude-desktop-re/web-bundle/v2/`.
- `services.json` means `/Users/new/claude-desktop-re/web-bundle/services.json`.
- `messages.txt` means `/Users/new/claude-desktop-re/web-bundle/messages.txt`.
- Orientation notes: `/Users/new/claude-desktop-re/ARCHITECTURE-2.9939.2.md` and `/Users/new/claude-desktop-re/WEB-UI-INVENTORY-2026-09-25.md`.

Citations use actual original line numbers. Many minified main-process chunks are almost entirely line 1; the core is largely line 13 and the SDK implementation line 7. Function names/test IDs supplied alongside citations are search anchors, not reconstructed source names. `services.json` is one line and contains names, not complete method signatures; boundary schemas are in the core service declarations. Recommendations marked **Import / Adapt / Skip** are MAWS design judgments, not claims about shipped behavior.

## Executive summary

### Ten things MAWS should import or adapt

1. **Import attention-first session status.** A row must distinguish needs-attention, running, and unread activity; project groups should expose new-session actions. This fits MAWS’s project→session hierarchy better than an undifferentiated recent-chat list. [shared-22-BxLORN1T.js:2; shared-25-BZtm97sd.js:2; shared-24-Dwl0T1gH.js:2]
2. **Import explicit execution context.** Keep environment, folder, starting branch, and worktree choice visible before sending. The existing UI warns when another session is using the same folder. [cc43287c9-Dhm1ErF1.js:26,28]
3. **Import a measured, virtualized transcript with independent tail controls.** Transcript history, loading older rows, pinned actions, and bottom chrome are separate concerns. Preserve those boundaries in MAWS rather than building a single growing chat DOM. [c1c1ec7b9-DVuWiUSs.js:117]
4. **Import progressive tool disclosure.** Show active/recent steps, hide older tool detail behind accessible controls, and disclose truncation. Do not expose every token of every tool by default. [shared-14-DNjmCwiw.js:7]
5. **Import explicit approval scope and delivery state.** Once/session/project/user/host grants are different. An approval response can fail delivery and must return to pending rather than disappearing optimistically forever. [c1c1ec7b9-DVuWiUSs.js:59,61; shared-12-4P3rNZ7K.js:31; index.chunk-9hgN2KD3.js:1, `respondToToolPermission`]
6. **Import queued versus delivered versus failed messages.** Queue controls, immediate steering, retry, and discard should be distinct from the transcript’s historical user turns. [shared-16-rKjFxBum.js:26,63; c63275c0a-CWNVmm4G.js:25; services.json:1, LocalSessions]
7. **Adapt findings-to-diff navigation.** “Walk through in diff” does more than open a diff: it selects a finding, installs annotations, and navigates to file/side/line. This belongs naturally in MAWS’s right diff panel. [c1c1ec7b9-DVuWiUSs.js:90]
8. **Import safe worktree lifecycle distinctions.** Archive, remove a clean checkout, discard uncommitted files, delete conversation history, and delete a branch are not equivalent operations. [messages.txt:2928–2933,11001–11019]
9. **Adapt contextual files/artifacts and side chat.** A compact active-document bar, artifact-local chat, and attach-as-context affordances are stronger precedents than putting every file action in the transcript. [c21f11e6d-j1zvAikh.js:2; c63275c0a-CWNVmm4G.js:13; cca654f75-CxzXNdLz.js:1]
10. **Import honest liveness and process ownership.** Distinguish unreachable computer, reconnecting transport, paused/released runner, stopped preview, and running underlying server. Closing a terminal tab can terminate its command and warrants explicit confirmation. [shared-16-rKjFxBum.js:26; cc43287c9-Dhm1ErF1.js:32; messages.txt:7863–7912,18718–18735]

### Five most important engine facts

1. **Desktop is not a terminal scraper.** It invokes the bundled Agent SDK’s `query({prompt, options})`; the SDK launches Claude Code with bidirectional stream-json and routes control requests separately. [index.chunk-9hgN2KD3.js:1, `spawnSessionQuery`; index.chunk-CHNweogn.js:7, `ProcessTransport` / `Query`]
2. **The application contract is much larger than the SDK contract.** `LocalSessions` has **307 methods, 9 events, zero stores**. Git, filesystem, resources, plugins, scheduling, runtime installation, renderer state, and much policy are application responsibilities around the SDK. [services.json:1]
3. **Permission handling is an asynchronous broker, not a boolean callback.** CLI `can_use_tool` → SDK callback → app pending request → IPC `onEvent` → renderer card → `respondToToolPermission` → SDK `control_response`. Abort, policy denial, scoped rules, and response failure all matter. [index.chunk-CHNweogn.js:7; index.chunk-9hgN2KD3.js:1; index.chunk-DzZc-q0x.js:13; index.chunk-BURbyyNT.js:1; shared-12-4P3rNZ7K.js:31]
4. **Desktop metadata and CLI transcripts are separate persistent objects.** Desktop stores account/org-scoped session records; Claude Code keeps JSONL history. Forking coordinates transcript copies, worktree placement, titles, and new app IDs, not merely a UI tab clone. [index.chunk-9hgN2KD3.js:1, `getStorageDir`, `writeSessionToDisk`, `forkSession`]
5. **The captured SDK is a versioned, extended integration, not proof of today’s public SDK surface.** Desktop tracks a build-pinned CLI and SDK-wrapper version, negotiates features, and passes options such as managed settings, user-dialog callbacks, and host-auth callbacks. MAWS should own a versioned adapter and verify supported public/private contracts before implementation. [index.chunk-DzZc-q0x.js:13, `getPinnedCliVersion`, `getSdkWrapperVersion`; index.chunk-9hgN2KD3.js:1, SDK-options construction]

# Deliverable A — UX study

## A1. Sidebar: projects, sessions, pinned, recents

**Observed structure and states.** Pinned, Projects, and Recents are distinct containers. Group headers accept collapsed/onToggle state. Grouping modes include date, project, unread, state, type, folder, custom, and none; some Code-specific grouping paths are gated. There are placeholder/skeleton rows, show-more truncation, drag/reorder behavior, environment/status/activity-age filters, and nested session rows. The project list initially truncates at 20. The source shows state access and toggling but does not establish restart persistence for every collapse setting. [shared-25-BZtm97sd.js:2,3,8]

**Session row content and status.** Session name is actionable/renameable; the accessible rename label is “{name}, rename session” and the input is “Session name.” Generic session-row marks prioritize **Needs attention**, then animated **Session running**, then **Unread activity**. Code grouping derives blocked/working/ready/done/idle buckets from errors, approval waits, running state, unread/completed state, and PR state. Nested Code rows have “Hide/Show nested sessions” and counts for input/new/working children. Do not assume every row always displays a branch, timestamp, or token total: that exact universal row composition was not established. [messages.txt:5917–5923; shared-22-BxLORN1T.js:2; shared-25-BZtm97sd.js:2; shared-23-COOUG4Ka.js:2]

**New session.** Group-header plus buttons invoke `onNewSession('plus_button')`, with “New session in {group}” copy. This is contextual creation rather than forcing a detour to a global home screen. [shared-25-BZtm97sd.js:2; shared-24-Dwl0T1gH.js:2]

**MAWS verdict — Adapt.** Use projects as the stable top-level grouping, session names plus attention/running/unread indicators, and a new-session action per project. Import pinning, collapse, nested-child disclosure, and show-more/loading states. Do not import every alternate grouping mode initially; they complicate a deliberately project-first workstation. Keep subagent topology in the auxiliary panel while retaining compact child counts in the sidebar.

## A2. Session setup and execution context

**Origin/environment.** Origin chrome has an icon/pressed gutter, accessible glyph label, environment name and folder label, and a remote-control-locked notice. The environment pill shows icon plus name and the tooltip “Where Claude runs”; it becomes a dropdown when alternatives exist and a simple pill with a sole choice. Local/Desktop-only states exist. [cc70f2bdf-BuHVM8pi.js:8; cc43287c9-Dhm1ErF1.js:26]

**Folder, branch, and worktree.** Draft setup exposes folder selection, additional folders, searchable “Branch to start from,” and a supported-only Worktree checkbox. The folder chooser permits “any folder, git or not”; worktrees require Git support. Branch switching surfaces uncommitted-change and same-folder-session warnings. A running peer suggests “Another session is running here” and turning on Worktree to keep changes apart. “Branch for this session” is setup copy, not evidence that every session must have its own branch. [cc43287c9-Dhm1ErF1.js:26,28]

**Guided branch question.** The in-session `epitaxy-setup-question-branch` path asks “Work on a separate branch?” It defaults to a new branch, with `claude/changes` as a fallback suggestion, offers “New branch …” and “Stay on the current branch,” and explains whether the app switches before edits or commits to the checked-out branch. This is distinct from the draft Worktree checkbox: **a branch choice is not inherently a separate working directory**. [c1c1ec7b9-DVuWiUSs.js:3]

**Worktree location.** The UI offers project-local `.claude/worktrees` or a custom host-level location, one subfolder per project, validation, and “Worktree folder saved.” Remote-host settings are separate from local placement. [cc43287c9-Dhm1ErF1.js:26; messages.txt:17961–17972]

**Split suggestion.** “See multiple sessions side by side in split view” / “Open in split view” adds a pane. The suggestion is suppressed when an additional pane already exists, has dismissal backoff, and caps impressions at three. [c11959232-KxYmIwSL.js:2]

**MAWS verdict — Import context, adapt presentation.** Put project/folder and branch/worktree together in a compact setup bar. Make “current working directory” versus “isolated worktree” explicit, with conflict information before sending. For the current local-first scope, skip cloud/remote environment complexity but keep an execution-target field in the underlying model. Adapt split-view education to MAWS’s actual tab/split policy rather than duplicating a suggestion card prematurely.

## A3. Transcript, tools, turns, threads, delegation

**Virtualized transcript.** The main container is `role="feed"`. Measured `transcript-row`s carry indexes/ref callbacks; `transcript-sizer`, top/bottom spacer heights, end sentinels, loading-older/retry states, and windowed rows support long histories. Tail actions/chrome are distinct from message rows, with bottom fades/backing elements. Native overflow anchoring is disabled and application pin/scroll logic takes over. These are code-visible mechanisms; the quality of the live anchoring was not measured. [c1c1ec7b9-DVuWiUSs.js:117]

**Tool rows and collapse.** Tool rows have disclosure carets, status pills with `aria-expanded`/`aria-controls`, writing sparks, parameter/body detail, and explicit “Output truncated.” A timeline block using `autoCollapse` and at least three items initially hides all but its last two; “# steps” and “Hide steps” expand/collapse it with animation. That particular rule is a timeline rule, not a universal rule for every tool group. [shared-14-DNjmCwiw.js:7]

**Turn status and plans.** The turn components include Classic, Clay, and Blocked marks and pending/settled, thinking/writing/idle/exit branches. `PlanStepLine` carries progress and elapsed time. Treat the mark names as internal presentation variants, not SDK protocol states. The thinking placeholder progresses through “Thinking…”, “Still thinking…”, “Thinking more…”, “Thinking some more…”, and “Almost done thinking…”. [shared-15-DCsp3l1A.js:7; c1c1ec7b9-DVuWiUSs.js:95]

**Thread steps and computer control.** A thread step renders truncated state-labelled text and “View thread” or “Open thread — # replies.” Computer-control chrome distinguishes connecting/connected/disconnected and reason, shows folder and optional device/instructions in a popover, and offers disconnect for connecting/connected states plus a manage action. [c63275c0a-CWNVmm4G.js:11; ceeb23eca-BmGW5IVN.js:18]

**Findings → diff.** “Walk through in diff” is available for applicable/actionable findings when a diff is present. It selects a finding, stores annotations, and scrolls the diff tile to the relevant file, side, and end line. [c1c1ec7b9-DVuWiUSs.js:90]

**Subagents/workflows.** Workflow UI shows “Waiting for agents to start,” done/running/stalled/failed counts, “More agents may appear,” and “Stop this workflow.” Permission copy explicitly warns that a dynamic workflow can start many parallel subagents and can be stopped in the tasks pane. Very large-session fallback copy admits that some subagent activity or earlier messages cannot be displayed. [c1c1ec7b9-DVuWiUSs.js:53,90,117]

**Connector delegation is a separate surface.** The `delegation-*` card has proposed/running/result-ready phases. It says “Only visible to you”; a connector owner reviews exact instructions, chooses “Approve and run” or “Deny,” privately reviews the result, then chooses “Share with project” or “Discard.” Changed content requires re-review; hidden/direction-changing characters trigger a warning and can block approval/sharing. This is not evidence that all ordinary subagents need this owner-consent workflow. [c1c1ec7b9-DVuWiUSs.js:80]

**MAWS verdict — Import core mechanics, adapt semantic hierarchy.** Keep human turns readable; progressively disclose tools; give active work and blocked work stable anchors; use the right panel for full agent topology and task history. Import finding-to-diff navigation and explicit truncation/large-history limits. Adapt plan and status rendering to actual engine events. Skip connector-owner delegation unless MAWS introduces cross-user credential delegation. Avoid time-based copy that sounds like a reliable prediction of completion—“Almost done thinking” is copy, not evidence of actual progress.

## A4. Tool approvals, isolation, and policies

**Actions and copy.** Standard cards offer Deny, Allow once, optionally Allow for this session, optionally Always allow / Allow for all tasks, and sometimes “Allow and switch to Auto” with “Auto reviews the rest of this session.” Scope explanation varies: session, project, local project, user settings/all projects, connector account, SSH host, or a timed scheduled-task grant. Organization caps, destructive/config constraints, managed ask rules, and unavailable/disabled organization policy can remove or disable persistence choices. [c1c1ec7b9-DVuWiUSs.js:59,61]

**Keyboard and viewing gates.** Ordinary shortcut props show Esc for deny, Cmd+Enter for once, and Cmd+Shift+Enter for a persistent action, but some requests instead dismiss or ignore Escape. Detail/read/paint gates can delay allowing until content is viewed while retaining Deny. A separate screen-control handler ignores IME composition and repeated keys, yields to dialogs, interactive elements and composer popups, avoids inactive/offscreen panes, and uses an arbitration mechanism before claiming Escape or Cmd/Ctrl+Enter. These exceptions are essential in a multi-pane app. [c1c1ec7b9-DVuWiUSs.js:3,59,61]

**What actually persists.** The engine’s `once` result allows with updated input; an ExitPlanMode once response can also set a session mode. `always`/`scheduled` return permission updates from suggestions and retain applicable session rules/directories in session metadata. Scheduled tasks can retain approved permissions; SSH host grants have their own remembered-grant path. A deny may carry user feedback and can interrupt. UI labels must not be treated as uniform storage destinations: the rule destination and tool-specific broker determine scope. [index.chunk-9hgN2KD3.js:1, `respondToToolPermission`, `accumulateSessionPermissionUpdates`]

**Browser and computer grants are not ordinary CLI rules.** Browser copy explicitly says “Allow once applies to this page only. Always allow saves on this device (revoke in Settings).” A private-host read grant can add an allowed site. Screen-control grants carry application bundle IDs, tiers, clipboard and key-combination permissions; unresolved apps are denied. [c1c1ec7b9-DVuWiUSs.js:3,50]

**Isolation notice.** `tool-isolation-notice` renders for blocked MCP and/or web search, selects distinct localization IDs, and offers a new-chat callback. Its English text is not embedded at that component site; inventing exact explanatory copy would exceed the evidence. [shared-16-rKjFxBum.js:63]

**Tool policies.** Organization connector policies group Read-only, Write-delete, and Other. Allow lets the user choose Always allow / Ask / Block; Ask permits Ask / Block; blocked disallows use. Rows show inherited/default state, “Use connector default” reset, and an approval-required lock explaining that Anthropic requires approval every use. This is an admin connector-policy surface, not the standard per-call card. [c31521777-Q61fKe-Y.js:1]

**MAWS verdict — Import semantics, adapt the card.** A permission card needs tool/input/context, explicit scope, conservative keyboard ownership, pending/resolving/failed-delivery states, and a clear denial path. Keep persistent rule editing distinct from transient approval. Skip organization-policy administration in the initial local workstation, but preserve policy reasons and non-overridable restrictions in the contract. Never let a global keyboard shortcut approve a request in an inactive tab.

## A5. Composer, presets, queue, failed send, models, effort

**Draft configuration.** Presets have New preset, Update preset, Save as new preset, edited state, and session overrides for model/effort/permission settings. The draft rail includes environment/folder/branch/worktree controls rather than burying execution configuration in a separate settings page. [cc43287c9-Dhm1ErF1.js:26,28]

**Queue.** Queued messages display “Queued,” can be sent now or discarded, and have a discard confirmation that the message is removed from the queue and will not be sent. The engine inventory separately exposes cancel, reorder, promote, and immediate steering. Archived sessions hold messages until unarchived. [shared-16-rKjFxBum.js:26,63; cc43287c9-Dhm1ErF1.js:61; services.json:1]

**Failure.** Failed user sends display “Not delivered,” optionally a time, plus Retry/Discard and an accessible status region. Approval-response delivery has its own retryable error (“Permission response couldn’t be delivered. You can try again.”). A misleading inventory shortcut must be corrected: the `stale-*` elements located in `shared-16` are stale **sharing**, not a demonstrated stale-send state. [c63275c0a-CWNVmm4G.js:25; shared-16-rKjFxBum.js:26,63; shared-12-4P3rNZ7K.js:31]

**Models and effort.** `epitaxy-cds-model-selector` is catalog-driven, with per-model recommended effort, capability-dependent effort options, and fast mode. xhigh/max are gated by model capability; there is no justified fixed five-choice list for every model. Model/effort-change confirmation warns that Claude re-reads the cached session on the next message, using more of the limit, with “Don’t ask again.” Manual/Auto explanation differentiates asking before actions from automatic review/blocking. [c360a9e1c-CPGBhuJc.js:1–2; cc43287c9-Dhm1ErF1.js:34]

**MAWS verdict — Import delivery semantics; adapt presets and selector.** Preserve draft independently of send, display queue ownership and delivery truth, and support steering separately from interrupt. Offer model capabilities from the running engine rather than hard-coding names/effort levels. Presets are useful after the underlying per-session settings stabilize. Do not silently clear a draft or failed message because the session tab changed.

## A6. Aside, stats, status, resources, sharing, archive

**Correct the surface names.** `epitaxy-aside` is a headed side-chat/aside message row with hover/focus actions and attach-as-context; one heading is “Claude replied:”. It is not evidence of the planned MAWS right-hand sidebar. [c63275c0a-CWNVmm4G.js:13]

**Stats and status.** The stats card is aggregate usage, default Overview/All, tabs Overview/Models, ranges All/30d/7d. Metrics include Sessions, Messages, Total tokens, Active days, Peak hour, and Favorite model; model usage has input/output tokens, an empty state, and more/less. The separate outlined Session info card is max-width 360px, grouped rows, loading placeholders, per-row copy, and Copy session info. Metadata strings include You/Routine/Remote Control/Forked with time, and SSH/WSL host variants. [cf6ae6197-C8E8xVRa.js:7; c1c1ec7b9-DVuWiUSs.js:75; messages.txt:3405–3420]

**Footer indicator.** A small focusable, truncated neutral pill has a diamond-like prefix and full-label tooltip: “Set by Claude Code’s server configuration.” Do not misrepresent server-selected configuration as an editable local preference. [cc70f2bdf-BuHVM8pi.js:8]

**Workflow token projection.** For a running local workflow, projected tokens are `max(totalTokens, round((startedAgents ? totalTokens/startedAgents : 70000) * scheduledAgents))`. Warning thresholds are strictly above 25 scheduled agents or 1,500,000 projected tokens; wording differentiates agents/tokens/both and offers Stop workflow. This is a workflow fan-out estimate, not a general context-window meter. [cc43287c9-Dhm1ErF1.js:26; messages.txt:17885–17889]

**Disk and uncommitted work.** Notices distinguish remote home or `/tmp` out of space, local computer out of space, read-only disk, and setup failure. “Continue on {branch}” can show “# uncommitted file(s)” and prefill a request to inspect/finish work in progress. [messages.txt:17850–17859; cc43287c9-Dhm1ErF1.js:28]

**Cleanup/archive.** Cleanup normally preserves uncommitted work; committed work remains on its branch. Explicitly opting into “Also remove # worktree(s) with uncommitted changes” warns of loss. Deleting sessions/conversations is separately optional. For an archived session, discarding the kept worktree removes its disk checkout and uncommitted changes but keeps the archived conversation and branch. [messages.txt:11001–11019,2928–2933]

**Archive on PR close.** “Auto-archive sessions when their pull request closes” is refined by per-session copy: archive once the PR **merges or closes**; disabling leaves it listed. Related automatic-archive deferrals mention pinned/nested sessions, live background work, waiting for a reply, remote control, keep-awake, and queued messages. These conditions should not be reduced to an unconditional PR webhook action. [messages.txt:2894–2905,3659–3674]

**Sharing and rename.** Sharing offers Private (“Only you have access”), Team (“Everyone in {orgName} can view this session”), Public, Copy link, revoke, and failure states. Copy differentiates repository-access-restricted viewers from anyone-with-link viewers and warns about private-repo code/credentials. This is session sharing, not artifact publishing. Rename has an accessible label and a Session name input. [c50a441b7-B6YdETpB.js:1; messages.txt:7519–7533,5917–5923]

**MAWS verdict — Import operational metadata and safe cleanup; adapt/defer the rest.** Session info and contextual side chat fit immediately. Token/context/cost visibility belongs in MAWS, but aggregate usage is a separate view and workflow projection must be labelled as estimated. Import conservative cleanup. Defer cloud/public sharing and broad usage analytics until their product purpose is explicit. Adapt auto-archive as opt-in automation only once PR ownership and background-work state are reliable.

## A7. Remote control and paused sessions: local-first lessons

Remote Control on allows following/steering from claude.ai/mobile; off disconnects followers and stops reconnection. Transcript cards distinguish reconnecting, message-dropped reconnect, start failed, and turned off. Frame-host liveness polls `/status` when authenticated and renders “session…”, “session live”, or “session offline”; offered Review plan/Message actions disable when not live. This frame widget is not proof that the primary Code session uses the identical polling mechanism. [messages.txt:2867–2874; c1c1ec7b9-DVuWiUSs.js:82; frame-shell-chrome-jvKEkShs.js:4]

“Can’t reach your computer” can offer continuing in cloud or retrying after reconnect. Paused-runner copy explicitly says the runner was released and may change when resumed; depending on configuration, focus/type or send resumes it. SSH reconnect exposes network/name-resolution/refusal/key/sign-in/retry stages and worktree restoration, distinct from remote-control follower connectivity. [shared-16-rKjFxBum.js:26; cc43287c9-Dhm1ErF1.js:32; messages.txt:17807–17821,17845–17863,18147–18158]

**MAWS verdict — Adapt liveness, skip remote-product scope initially.** Model process state, transport state, and message-delivery state separately. On local engine exit, say what stopped and whether unsent input survives. Provide reconnect/restart/resume only when they mean different supported actions. Do not import “different runner” or cloud handoff language into a purely local session. Preserve target identity so later SSH support does not require redefining sessions.

## A8. Cowork, artifacts, terminal, preview, routines

| Surface | Behavior, states, copy | MAWS verdict |
|---|---|---|
| Active document | File icon, truncated document name, optional clickable name/whole-bar expansion, word count, Copy document text, Dismiss, copy-failure state. [c21f11e6d-j1zvAikh.js:2; messages.txt:4699–4703] | **Import.** A compact context bar tells the user which document/file is being discussed without duplicating it in every message. |
| Add folder | Icon-only FolderPlus with accessible Add folder; a task not linked to this computer can say “Link this task to this computer to add folders”; disabled states expose reasons. [shared-9-CtVPc8gf.js:2] | **Adapt.** Keep folder access explicit, but skip linking language for already-local MAWS sessions. |
| Artifact frame header/switcher | Comfortable-density header, title/leading chrome and trailing actions. Switcher appears for two or more frames and opens a selection popover. Title menu includes rename, duplicate, versions, share, storage, report/delete with disabled reasons. [cca654f75-CxzXNdLz.js:1; ca324bb72-HVBJr-Tg.js:1] | **Adapt.** Use MAWS file/artifact tabs as the primary switcher, contextual actions in the viewer, and no duplicate navigation hierarchy. |
| Artifact chat | “Describe the change you want…” / “Ask Claude about this artifact…” plus conditional Pop out chat. [messages.txt:11–16; 881cd3d8a4dc14e7595282cee3e405763205903eeaa57561-DDz9AhmG.js:1] | **Import context binding; adapt pop-out.** Right-panel side chat should identify its session/file scope and whether it can affect the main run. |
| Send to Claude | Confirmation previews source/title, structured content, optional presence, and expandable raw text; readiness and scrolling preview to bottom gate confirmation. Comment posting/marking as sent can still fail delivery if wrong artifact is open, session ended/not accepting messages, or sign-in expired. [cd2949ef9-GPlQy4rt.js:2; messages.txt:25044–25058,25177–25185] | **Adapt.** Preview precisely what will be sent and show delivery truth. Import a forced-read gate only for high-consequence transfer, not every routine file attachment. |
| Terminal | Loading placeholder/cursor; multiple numbered tabs; add/rename/close/close-other/clear and keyboard instructions. Closing a tab with a running command stops it and asks for confirmation. [cccc2cf0a-CVUXWHS7.js:1; messages.txt:18718–18735] | **Import.** Define terminal ownership independently of session transcript, and distinguish hide-pane from terminate-command. |
| Preview | Embedded-view refusal (“This page can’t run in an embedded view. Open it in its own tab”), too-small state, cold dev-server wait, Keep waiting/Stop loading/Ask Claude, overload caution, nothing-listening state, stopped preview with still-running server, and localhost/private/external constraints. [cd50800c7-ExDUbAUN.js:4; messages.txt:7863–7912] | **Import state model; adapt browser integration.** Separate browser view lifecycle from server process lifecycle. Expose logs/source and let Ask Claude include the actual failure context. |
| Routine dialog | Large responsive task/chat/code dialog; folder/project, schedule/cron, permissions, notifications; local folder requires an awake computer; execution location cannot change after creation; five-field cron, cloud minimum hourly, timezone/exact-time and unsaved-change warnings. [c97b955f1-CvRzpiR5.js:1; messages.txt:13240–13281,6727] | **Skip initially.** Scheduling is a distinct reliability and unattended-permission feature. Keep task/session provenance extensible but do not import the full routine product merely because a service exists. |

## A9. Design-system facts

The CSS defines semantic themes, neutral/accent ramps, role colors, spacing, typography, dimensions, duration, and interaction tokens. Representative **actual names**:

- Color/surfaces: `--cds-surface-0`, `--cds-surface-1`, `--cds-surface-2`, `--cds-page-bg`, `--cds-text-primary`, `--cds-text-secondary`, `--cds-text-muted`, `--cds-text-accent`, `--cds-border`, `--cds-border-strong`, `--cds-fill-primary`, `--cds-fill-secondary`, `--cds-role-success-fill`, `--cds-role-warning-fill`, `--cds-role-danger-fill`.
- Spacing: `--cds-pad-xs`, `--cds-pad-sm`, `--cds-pad-md`, `--cds-pad-lg`; `--cds-gap-xs`, `--cds-gap-sm`, `--cds-gap-md`, `--cds-gap-lg`.
- Geometry: `--cds-radius`, `--cds-radius-composer`, `--cds-h-control`, `--cds-h-control-nested`, `--cds-icon`.
- Typography: `--cds-font-sans`, `--cds-font-mono`, `--cds-font-size-caption`, `--cds-font-size-body`, `--cds-font-size-prose`, `--cds-leading-body`, `--cds-leading-prose`.

All names above are present in `c6a992d55-DRT6pRFV.css:1`.

The baseline root has a comfortable-density override: radius changes from .375rem to .5rem and control height from 1.5rem to 2rem. Dark theme remaps semantic values—for example surface-1 from gray-10 to gray-850. Desktop has an interactive-cursor override. There is no established explicit `.cds-root[data-density=compact]` root block; baseline plus comfortable overrides and compact utility selectors are the observed structure. Do not take the first occurrence of a variable in minified CSS as its default: utilities and contextual overrides occur before/after root declarations. [c6a992d55-DRT6pRFV.css:1]

Registered fonts include variable `anthropic-sans` and `anthropic-serif`, normal/italic weights 300–800, `anthropic-mono`, OpenDyslexic, and Atkinson Hyperlegible Next. Sans resolves through Anthropic-specific variables with system fallback. [c6a992d55-DRT6pRFV.css:1]

**MAWS verdict — Adapt the token architecture, not the brand assets.** Use semantic surface/text/status tokens, distinct chrome/prose/mono typography, and compact versus comfortable density. MAWS’s sidebar and auxiliary tools can be dense while the transcript remains comfortable. Treat fonts and exact color values as benchmarking evidence, not a requirement to redistribute proprietary assets.

# Deliverable B — engine contract

## B1. Complete LocalSessions inventory

**Verified counts:** 307 methods; 9 events; **no stores declared**. The grouping below is analytical organization, not separate IPC services. A programmatic coverage check found all 307 original method entries exactly once. Source for every name in this section: `services.json:1`, key `LocalSessions`; signatures and validators: `index.chunk-DzZc-q0x.js:13`, `Do(...,"LocalSessions",...)`.

### Lifecycle, importing, listing, rewind — 38

`start`, `forkSession`, `detachFromParent`, `warmSession`, `restartRemoteSession`, `retryStart`, `confirmImportedSessionResume`, `prewarmAuth`, `canAutoResume`, `stop`, `clearSession`, `rewind`, `rewindV2`, `rewindToRefusedPrompt`, `rewindFiles`, `discardPendingTurn`, `resumePreClearSession`, `undoRewind`, `switchRewindMark`, `archive`, `unarchive`, `delete`, `getSession`, `findLocalSessionIdForBridgeId`, `getAll`, `getSessionList`, `loadArchivedSessions`, `getSessionsForScheduledTask`, `getDetectedProjects`, `probeSessionRepoMarkers`, `importAllCliSessions`, `probeImportableCliSessions`, `listCliSessions`, `readCliTranscript`, `openCliTail`, `closeCliTail`, `listResumableCliSessions`, `resumeCliSession`.

### Messaging, queue, side chats and child sessions — 15

`sendMessage`, `startSideChat`, `sendSideChatMessage`, `stopSideChat`, `interruptSideChat`, `startBtwChild`, `closeBtwChild`, `interrupt`, `markPeerMessagesRead`, `cancelQueuedMessage`, `reorderQueuedMessage`, `promoteQueuedMessage`, `sendSteeredNow`, `acceptSideSessionOffer`, `muteSideSessionOffers`.

### Model, effort, thinking and output styles — 17

`setModel`, `setEffort`, `getEffort`, `getAdvisorSetting`, `setFastMode`, `setThinkingSummariesWanted`, `applyFlagSettings`, `validateNewOutputStyleName`, `createOutputStyle`, `cancelCreateOutputStyle`, `refreshOutputStyles`, `revealOutputStyle`, `listGlobalOutputStyles`, `getDefaultEffort`, `getClaudeCodeRestartVersions`, `applyModelByRestart`, `setAvailableCodeModels`.

### Usage and stats — 3

`getContextUsage`, `getContextUsageSummary`, `getCodeStats`.

### Permissions, trust and policy — 25

`respondToToolPermission`, `respondToRefusalFallbackPrompt`, `respondToAutoModeServerFallbackPrompt`, `respondToLanyardConsent`, `respondToViolinBowPrompt`, `checkTrust`, `checkStoredTrust`, `saveTrust`, `answerPendingCwdTrust`, `setPermissionMode`, `getPermissionMode`, `setChipLevel`, `getChipLevelPreference`, `setChipLevelPreference`, `getDefaultPermissionMode`, `writeAutoModeProposalFile`, `cleanupAutoModeProposalFile`, `openMacFilesAndFoldersSettings`, `classifyTccFolderKind`, `checkRemoteTrust`, `checkRemoteTargetTrust`, `saveRemoteTargetTrust`, `getSSHHostToolGrants`, `removeSSHHostToolGrant`, `clearSSHHostToolGrants`.

### Workspace, files, editors and media — 26

`getInstalledEditors`, `openInEditor`, `revealRemotePath`, `pickSessionFile`, `pickFileAtCwd`, `readFileAtCwd`, `readSessionFile`, `readSessionFileWithStatus`, `resolveSessionFile`, `showSessionFileInFolder`, `showSessionFilePreview`, `openSessionFileInDefaultApp`, `listSessionDirectory`, `readSessionImageAsDataUrl`, `getSessionImageStreamUrl`, `readSessionMediaAsDataUrl`, `readSessionPanelMediaAsDataUrl`, `getSessionMediaStreamUrl`, `getSessionPanelMediaStreamUrl`, `readSessionPanelDocumentAsDataUrl`, `writeSessionFile`, `createScratchWorkspace`, `prewarmFolderless`, `discardPrewarm`, `changeCwd`, `addDirectories`.

### Git, branches, worktrees and diffs — 35

`getUncommittedChanges`, `discardKeptWorktree`, `getGitInfo`, `getLocalBranches`, `getGitDiff`, `getGitDiffStats`, `getDiffFileContent`, `getGitDiffFilePatch`, `getGitCommits`, `getCommitDiff`, `refreshGitState`, `setAccountBranchPrefix`, `getSSHGitInfo`, `getSSHLocalBranches`, `getSSHGitDiff`, `getSSHGitDiffStats`, `getSSHGitCommits`, `getSSHCommitDiff`, `getSSHDiffFileContent`, `getRemoteGitInfo`, `getRemoteGitDiff`, `getRemoteGitDiffStats`, `getRemoteGitCommits`, `getRemoteCommitDiff`, `getRemoteDiffFileContent`, `getSSHWorktreeLocation`, `setSSHWorktreeLocation`, `getSSHWorktreeDefaults`, `isWorkingTreeDirty`, `getWorkingTreeDirtyState`, `checkBranchSwitchConflict`, `getWorkingTreeStatus`, `stashWorkingTree`, `commitWipForBranchSwitch`, `discardWorkingTree`.

### PRs, forges and automation — 40

`checkGhAvailable`, `listGhIssues`, `getGhIssue`, `getGhRefSummary`, `getGhRefSummaryWithStatus`, `getGhUserSummary`, `getCrRefSummary`, `getCrCliStatus`, `installGh`, `getPrChecks`, `getCheckRunAnnotations`, `rerunPrCheck`, `getPrStateForBranch`, `getPrDetails`, `getPrReviewComments`, `getPrOverview`, `getPrTimeline`, `getPrFiles`, `getPrCommits`, `getPrFileContent`, `fetchGithubImage`, `replyToPrReviewComment`, `resolvePrReviewThread`, `updatePrComment`, `createPrReviewComment`, `submitPrReview`, `updatePrBody`, `mergePr`, `setBoundPrAutoFix`, `setSessionAutoArchiveOnPrClose`, `armAutoFixOnNextPr`, `setAutoFixOwnPrsWanted`, `dismissBoundPr`, `enableAutoMerge`, `disableAutoMerge`, `markPrReady`, `markPrDraft`, `invalidatePrCaches`, `dequeuePr`, `resolveGithubRepoIds`.

### Remote control, sharing and cloud transfer — 9

`toggleRemoteControl`, `getRemoteControlStartState`, `dropsHostReplyStamp`, `shareSession`, `getTeleportReadiness`, `getTeleportPlan`, `teleportToCloud`, `resolveCloudBranch`, `enableCliRemoteControl`.

### SSH, remote hosts and WSL — 25

`testSSHConnection`, `probeSSHConnection`, `reconnectSessionHost`, `forceReconnectSSH`, `getSSHProxyOutput`, `getSSHLocalClientCapture`, `getSSHAuthSummary`, `getSessionSSHRemedies`, `getRemoteSSHRemedies`, `runSSHRemedy`, `listSSHDirectory`, `listRemoteDirectory`, `resolveSSHSettings`, `getSSHConfigs`, `listWslDistros`, `setSSHConfigs`, `getTrustedSSHHosts`, `setTrustedSSHHosts`, `getSSHSavedPassword`, `forgetSSHSavedPassword`, `respondToSSHPassword`, `getPendingSSHPasswordRequests`, `ackSSHPasswordRequestShown`, `reportSSHPasswordPromptHidden`, `declareSSHPromptKinds`.

### MCP and connectors — 18

`setMcpServers`, `replaceRemoteMcpServers`, `replaceEnabledMcpTools`, `sessionConnectorToggleStarted`, `respondSessionConnectorToggle`, `remoteStartMcpConfigStarted`, `respondRemoteStartMcpConfig`, `mcpAuthenticate`, `mcpReconnect`, `mcpRetryConnection`, `mcpSubmitOAuthCallbackUrl`, `mcpAuthenticateConfigServer`, `mcpClearAuth`, `mcpEnableServer`, `mcpCallTool`, `mcpReadResource`, `mcpListResources`, `getLocalMcpServers`.

### Agents, tasks and background shells — 21

`stopTask`, `backgroundTasks`, `setBackgroundTasksShortcutArmed`, `launchUltrareview`, `getSupportedCommands`, `getAgents`, `createAgent`, `startShellPty`, `stopShellPty`, `resizeShellPty`, `writeShellPty`, `getBusyShellPtyKeys`, `setShellPtyTitle`, `runBashCommand`, `interruptBashCommand`, `popBackgroundTaskSuggestion`, `popBackgroundTaskSuggestionById`, `getTaskBacklog`, `dismissTaskBacklogItem`, `notifySpawnedTaskStarted`, `notifySpawnedTaskUnstarted`.

### Transcripts and search — 6

`getTranscript`, `getTranscriptTail`, `getTranscriptPage`, `requestTranscriptPort`, `readTranscript`, `searchSessions`.

### Titles, metadata, navigation and view state — 16

`setAvailableNextActions`, `setSessionPaneMenuState`, `completeSessionViewRequest`, `completeCodeSettingRequest`, `setCodeSettingAvailability`, `completeStartTargetsRequest`, `updateSession`, `setCustomGroups`, `respondSidebarCommand`, `setFocusedSession`, `setVisibility`, `respondToTitleOffer`, `setManualKeepAwake`, `beginTearOffHalo`, `setTearOffHalo`, `endTearOffHalo`.

### Diagnostics, telemetry and feedback — 13

`logCliEvent`, `reportSwitchTiming`, `reportSwitchInitiated`, `reportSwitchAbandoned`, `reportComposerInp`, `reportTranscriptLoadEarlier`, `reportStreamRender`, `reportRunFollowUp`, `reportSessionDeadEnd`, `reportArtifactsReset`, `reportSessionListLoad`, `submitFeedback`, `createLogsHandoffBundle`.

### Events — complete list of 9

`onEvent`, `sidebarCommand`, `sessionViewRequest`, `codeSettingRequest`, `startTargetsRequest`, `onToolPermissionRequest`, `onSSHPasswordRequired`, `onSSHPasswordRequestWithdrawn`, `onSSHPasswordQueueChanged`.

**Stores: none.** The generated renderer listener for event `onEvent` is named `onOnEvent`; for `onToolPermissionRequest`, `onOnToolPermissionRequest`. Do not invent a `LocalSessions.sessions` IPC store. [services.json:1; mainView.js:1]

**What is not a standalone method family here.** There is no named LocalSessions hook-management API, plugin-install API, or artifact CRUD API. Hook behavior is in SDK options/settings; plugin/skill management is in adjacent services; published artifact metadata is consumed from session messages. `reportArtifactsReset` is a reporting name, not an asset repository API. The captured live loop handles `system/session_metadata` by adding published artifacts. [services.json:1; index.chunk-9hgN2KD3.js:1, `createBaseHooks`, SDK options, `session_metadata`]

## B2. Adjacent desktop services — complete requested inventories

All entries below are in namespace `claude.web`. Source for every method/event/store name: `services.json:1`, respective service key.

### ClaudeCode — 10 methods

`getStatus`, `prepare`, `checkGitAvailable`, `resolveLocalSettings`, `patchUserSettings`, `setEnableWorkflows`, `getPeriodUsage`, `setLocalSandboxEnabled`, `setStrictSandboxMode`, `getLocalSandboxStatus`.

Events: none declared. Stores: none declared. This is runtime/settings/sandbox/period-usage control, separate from individual session operation.

### GitState — 1 method, 1 event

Method: `getGitStateSnapshot`.

Event: `gitStateChanged`.

Stores: none declared.

### Resources — 13 methods, 2 events

`fetchMentionOptions`, `handleMentionSelect`, `setFocusedCwd`, `setFocusedSshTarget`, `getProjectFileList`, `getProjectFileListIfChanged`, `searchFileContents`, `setFindInPageClaimed`, `hideFindInPageOverlay`, `setFindInPageOverlayObstructed`, `setFindInPageOverlayObstructedInPopout`, `offerFindInPageInPopout`, `releaseFindInPageInPopout`.

Events: `findRequested`, `findStepRequested`. Stores: none declared.

The first seven names describe context/mention/file-index search; the remaining methods coordinate the shell’s find-in-page overlay. They should not all be copied into a MAWS file-search service simply because they share this service name.

### FileSystem — 19 methods

`writeFileDownloadAndOpen`, `writeFileDownload`, `whichApplication`, `appInfoForExtension`, `browseFolder`, `browseFolders`, `listDirectory`, `getSystemPath`, `openLocalFile`, `listFilesInFolder`, `readLocalFile`, `getLocalFileThumbnail`, `writeLocalFile`, `showInFolder`, `savePastedFile`, `browseFiles`, `browseFile`, `exportLocalFileToGoogleDrive`, `promoteScratchpadFile`.

Events: none declared. Stores: none declared.

### LocalPlugins — 16 methods, 1 event

`getPlugins`, `getDownloadedRemotePlugins`, `syncRemotePlugins`, `materializeEnabledPlugins`, `listSkillFiles`, `uploadPlugin`, `deletePlugin`, `setPluginEnabled`, `startPluginOAuthFlow`, `revokePluginOAuth`, `getPluginCliStatus`, `setPluginEnvVars`, `setPluginOAuthClient`, `getPluginShimOps`, `getPluginCliBatch`, `setPluginShimPermission`.

Event: `onCliOpAlwaysAllowed`. Stores: none declared.

### CustomPlugins — 14 methods, 1 event

`addMarketplace`, `removeMarketplace`, `refreshMarketplace`, `listMarketplaces`, `installPlugin`, `updatePlugin`, `uninstallPlugin`, `listAvailablePlugins`, `listRemotePluginsPage`, `checkPluginHasLocalChanges`, `getAndClearMigrationIssues`, `listLocalOrgPlugins`, `installLocalOrgPlugin`, `syncLocalOrgPlugins`.

Event: `localOrgPluginsSynced`. Stores: none declared.

### CCDScheduledTasks — 11 methods, 1 event

`getAllScheduledTasks`, `getScheduledTaskFileContent`, `updateScheduledTaskStatus`, `createScheduledTask`, `updateScheduledTask`, `removeApprovedPermission`, `getWatcherHistory`, `markListenerReady`, `setEventAckSupported`, `ackEvent`, `releaseDispatchClaim`.

Event: `onScheduledTaskEvent`. Stores: none declared.

The listener readiness, acknowledgement, and dispatch-claim methods are evidence that scheduling is a delivery/ownership problem as well as a cron form. [services.json:1]

## B3. Runtime discovery, installation, and version ownership

The core runtime manager sets storage to `app.getPath('userData')/claude-code`, which on the target macOS application is `~/Library/Application Support/Claude/claude-code`. It chooses platform/architecture, keeps build-pin and SDK-wrapper versions from a manifest, and supports a current target version, installation in progress, local override resolution, installed-version fallback, and auto-update high-water state. VM runtime storage is separate at `claude-code-vm`. [index.chunk-DzZc-q0x.js:13, `E9n`, runtime-manager constructor, `getHostTarget`, `getPinnedCliVersion`, `getSdkWrapperVersion`, `getHostSpawnSummary`]

Binaries live under the version directory; on macOS, a manifest-provided bundle changes the executable path instead of always assuming `<version>/claude`. Host binary readiness checks executable access, `.verified` against the expected checksum, and cached binary headers. Download paths are manifest/platform based; compressed payloads are SHA-256 verified, decompressed, made executable, installed through temporary paths, and marked verified. The application can preseed from packaged compressed payloads and fall back to a previously installed version. [index.chunk-DzZc-q0x.js:13, `getBinaryPathForTarget`, `binaryExistsForTarget`, `downloadBinaryForTarget`, `Wer`, `getAnyInstalledBinaryPathForTarget`]

**MAWS implication:** runtime installation/version selection needs its own component and readiness state. A PATH lookup alone does not reproduce Desktop. Do not equate app version, SDK-wrapper version, desired CLI version, and actually spawned CLI version.

## B4. Session spawn, query options, CLI flags, environment

### The call path

The core lazily loads `index.chunk-CHNweogn.js`. LocalSessionManager builds a prompt input stream and SDK options, checks cancellation/trust/worktree preparation, then calls `spawnSessionQuery`, whose essential operation is `query({prompt: inputStream, options})`. It retains the query object, input stream, spawn time, SDK server set, and pending post-spawn settings/MCP work. The live loop consumes `for await (...)` from the query. [index.chunk-DzZc-q0x.js:13, `Zfn`; index.chunk-9hgN2KD3.js:1, `spawnSessionQuery`, start sequence, query iterator loop]

### Options observed in the main session path

The assembled options include:

- `cwd`, model or `"default"`, normalized/inherited effort, and capability-dependent adaptive thinking.
- `managedSettings`, session/fast-mode/sandbox-related settings, and selected agent.
- `canUseTool` from the permission broker; user-dialog callback and supported dialog kinds.
- Per-task stop affordance, file checkpointing, permission mode, and capability/policy-dependent permission bypass eligibility.
- `settingSources: ["user","project","local"]`, partial messages, explicit environment, extra CLI arguments.
- App-supplied hooks, stderr handler, AskUserQuestion preview configuration, optional prompt suggestions.
- OAuth refresh and host-auth callbacks; additional directories; mode/feature-dependent allowed/disallowed tools.
- System prompt as the `claude_code` preset plus app append/snapshot, or a custom prompt path.
- Resumption fields: `resume`; rewind may add `resumeSessionAt` and `forkSession: true`.
- Selected executable path/args; SSH substitutes a remote CLI path/custom spawn path, while local version/launcher compatibility may modify flags and settings. [index.chunk-9hgN2KD3.js:1, SDK options near `canUseTool:this.permissionBroker.createCanUseTool`, `configureSSHSpawn`, `applyFreshBinaryPath`, prompt construction]

These are observed Desktop-bundled option names, not a claim that every option is in a released public npm SDK.

### CLI transport flags

The SDK ProcessTransport starts with:

`--output-format stream-json --verbose --input-format stream-json`

It adds thinking/effort/model and applicable budget/turn options, `--resume`, allowed/disallowed tools, MCP config, setting sources, strict MCP mode, permission mode, partial-message flags, session ID, fork/resume-related flags, managed settings, and optional `--no-session-persistence` from options. With a `canUseTool` callback it sets `--permission-prompt-tool stdio`; passing that callback together with `permissionPromptToolName` is rejected. Native executables versus script executables select different command/argument construction, and a custom spawn callback is supported. [index.chunk-CHNweogn.js:7, ProcessTransport initialization]

### Environment

The desktop auth environment explicitly sets entrypoint, API base, OAuth token/scopes, subscription/rate-limit fields, and desktop-app version, while clearing competing API-key/auth-token/custom-header slots in that construction path. The base session environment adds `DISABLE_MICROCOMPACT=1`, terminal MCP tool names, and `NODE_USE_SYSTEM_CA=1`; subsequent building merges scoped configuration and materialized secrets with provenance tracking. `ANTHROPIC_DEFAULT_SONNET_MODEL` appears in the permitted environment-variable set (alongside default Opus/Haiku/etc.), not as evidence of one universal hard-coded Sonnet value. A read-only helper fork separately scrubs that Sonnet override. The SDK defaults `CLAUDE_CODE_ENTRYPOINT` to `sdk-ts` only when absent and deletes `NODE_OPTIONS`. [index.chunk-DzZc-q0x.js:13, `Lur`, `EJ`; index.chunk-9hgN2KD3.js:1, `_fetchBaseQueryConfig`, `buildSessionEnv`, helper-fork `vj`; index.chunk-CHNweogn.js:7, ProcessTransport]

**MAWS implication:** construct a deliberate environment and version-aware option adapter. Do not inherit every variable, assume Desktop-specific auth semantics are generally available, or copy all experimental flags by name.

## B5. Permission and hook relay, end to end

1. **CLI → SDK:** a `control_request` with subtype `can_use_tool` carries tool name/input plus suggestions, blocked path, decision reason, display/description fields, tool-use ID, agent ID, and optional MCP provenance. Query invokes `canUseTool` with an abort signal. [index.chunk-CHNweogn.js:7, `processControlRequest`]
2. **SDK callback → Desktop broker:** `createCanUseTool` performs app policy/provenance/lifecycle checks and may allow or deny without showing a card. Otherwise the broker creates a request UUID, captures CLI tool-use/agent IDs and grant suggestions, puts a resolver in `pendingPermissions`, and emits `tool_permission_request` plus a session update. Abort resolves denial and removes the pending card; stall/renotify bookkeeping exists. [index.chunk-9hgN2KD3.js:1, `createCanUseTool`, `handleToolPermission`, `dismissPendingPermission`]
3. **Broker → renderer:** the actual main-process event bridge forwards manager events through LocalSessions `onEvent`; the generated preload listener is `onOnEvent`. A separately declared `onToolPermissionRequest` event exists, but its declaration alone is not the evidence for the active path traced here. [index.chunk-DzZc-q0x.js:13, event-forwarding around `dispatchOnEvent`; mainView.js:1]
4. **Renderer card → IPC:** the web permission store subscribes to request/resolved events, tracks requests by session, sets resolving state, and calls `respondToToolPermission(requestId, decision, updatedInput)`. On delivery failure it restores pending and reports a retryable error. [shared-12-4P3rNZ7K.js:31]
5. **IPC → broker resolver:** the LocalSessions implementation labels this response source `"card"`. The broker checks pending ownership/source restrictions, creates allow/deny plus input/rule/mode updates, saves app-retained grants where relevant, emits resolved, and resolves the callback promise. [index.chunk-BURbyyNT.js:1, `respondToToolPermission`; index.chunk-9hgN2KD3.js:1, responder and accumulation methods]
6. **SDK → CLI:** Query writes newline-delimited `control_response` with success/error, the original request ID, and the response object. Cancellation controllers prevent blindly answering stale requests. [index.chunk-CHNweogn.js:7, `handleControlRequest`, `handleControlCancelRequest`]

Hooks are also control traffic: initialize serializes matcher/callback IDs; incoming `hook_callback` requests invoke registered callbacks. Desktop’s base-hook construction includes PreToolUse app policy checks, including unattended-session restrictions. Hooks therefore complement permission prompting; they are not merely UI notifications. [index.chunk-CHNweogn.js:7, initialize hook payload / `hook_callback`; index.chunk-9hgN2KD3.js:1, `createBaseHooks`]

**MAWS implication:** approvals need request IDs, session/agent/tool attribution, scope-aware rule updates, cancellation, transport failure recovery, and safe keyboard focus. Persist intent/grants at the right boundary; do not let renderer optimism become authorization truth.

## B6. Live progress, subagents, tasks, and artifacts

The live engine distinguishes top-level events from child activity using `parent_tool_use_id`. Its bookkeeping recognizes assistant/user/stream/result messages, `tool_progress`, `tool_use_summary`, and system task events (`task_started`, `task_progress`, `task_notification`, `task_updated`). Top-level running/turn/attention decisions explicitly avoid treating child events as equivalent parent-turn boundaries. [index.chunk-9hgN2KD3.js:1, `On`, `Fi`, `H_`, `U_`, query loop]

The normalization/transcript helper also recognizes sidechain messages through `isSidechain` or nonempty `parent_tool_use_id`; its supported message set includes `tool_progress` and `tool_use_summary`. The SDK exports `listSubagents` and `getSubagentMessages`, in addition to normal session-message access. [index.chunk-CDfHHGGR.js:1; index.chunk-CHNweogn.js:7, exports]

**Important distinction:** raw disk JSONL can contain `type:"progress"`. The SDK disk parser accepts these while reconstructing transcript chains; its fork helper filters progress entries and repairs ancestry when rewriting messages. That does not establish a raw `progress` message as the desktop renderer’s live protocol. The observed live paths instead use the event types and parent attribution above. A MAWS adapter must preserve raw-vs-normalized provenance rather than folding every progress record into the primary conversation. [index.chunk-CHNweogn.js:7, `fH`, `fW`; index.chunk-9hgN2KD3.js:1]

Tasks are separately controllable: the SDK sends `stop_task` and `background_tasks` control requests; LocalSessions exposes stopTask/backgroundTasks plus task backlog/suggestion and child-session operations. The live loop processes `background_tasks_changed`, post-turn summary, task summary, session metadata/published artifacts, and prompt suggestions as distinct updates rather than displaying all of them as ordinary assistant prose. [index.chunk-CHNweogn.js:7, `stopTask`, `backgroundTasks`; services.json:1; index.chunk-9hgN2KD3.js:1, query loop]

Read-only side chats are separate helper forks: they may resume parent context with `forkSession: true`, use `persistSession: false`, constrain tools/reads, and deny prompts that would require unsupported interactive approval. They are not simply extra user messages injected into the parent run. [index.chunk-9hgN2KD3.js:1, `spawnReadOnlyFork`]

**MAWS implication:** maintain a causal tree/graph keyed by session ID, agent/task ID, tool-use ID, and parent ID. The main transcript is one projection; topology, background tasks, terminal activity, and side chat are other projections. Avoid counting a subagent result as the parent’s final result.

## B7. Persistence, titles, resumption, and forks

Desktop session metadata uses `userData/baseDir/accountId/orgId/<sessionId>.json`; the base name is `claude-code-sessions`. Session objects are serialized through a formatter, debounced while active/idle, normally written atomically, with a logged direct-write fallback for selected filesystem errors. Waiting input has a separate `waiting-input` manifest/blob path. The app also retains archive index hints and parked-account state. [index.chunk-DzZc-q0x.js:13, `xW`; index.chunk-9hgN2KD3.js:1, `getStorageDir`, `getSessionFilePath`, `writeSessionToDisk`, `iP` waiting-input persistence]

CLI history is separate JSONL under the Claude configuration projects area. Resumption uses the CLI session ID, not necessarily the app’s `local_...` ID. Rewind can resume at a specific message with fork semantics. App start/warm paths coordinate persisted metadata and CLI history instead of assuming one object is authoritative for everything. [index.chunk-9hgN2KD3.js:1, resume option construction, `forkSession`, transcript paths]

Titles carry provenance. `updateSession` defaults title source to user; an auto-generated title does not replace one deliberately named by user/tool. Previous titles and title offers are tracked. The title writer has a path to update the CLI transcript rename too. [index.chunk-9hgN2KD3.js:1, `updateSession`, title-writer logging around “Failed to write rename to CLI transcript”]

Desktop’s explicit fork path verifies a parent session/transcript, allocates a new `local_` ID, checks collisions/trust, and can acquire/create a new worktree. It copies all or a settled prefix of the parent JSONL, strips inherited Remote Control bridge pointers, updates transcript location bookkeeping, and registers the new session; failure can roll back a new checkout. Forking at the first turn can take a fresh-start path. This path is more than calling the SDK’s generic fork helper, though the SDK also supplies fork primitives. [index.chunk-9hgN2KD3.js:1, `forkSession`, `copyTranscriptUntilSettled`, `registerForkedSession`; index.chunk-CHNweogn.js:7, exported `forkSession`]

**MAWS implication:** store a stable app session record separately from the engine’s history/ID. Preserve title provenance, draft/queue ownership, workspace target, and fork lineage. A file tab, a conversation, a CLI process, and a worktree have different lifetimes.

## B8. Worktree creation and git shadow

`GitWorktreeManager` stores its registry in `git-worktrees.json` under userData, with restrictive config mode, cloned in-memory state, corruption preservation, and a logged in-memory-only fallback if the store is unavailable. It tracks leased/pool state, in-flight creates, pending removal/tombstone bookkeeping, and origin/ref state. [index.chunk-zPR7Bl2R.js:1, constructor and worktree store]

Default checkout placement is `<project>/.claude/worktrees`; a custom location creates a project-specific subfolder and avoids a direct path collision with the repository. Creation validates repository/worktree backlinks, guards ref/metadata paths, constructs `git worktree add --no-checkout`, adds `--no-track -b <branch>` for a new branch, handles existing branches/start points, and coordinates checkout/overlay work. The session engine can reuse a pool entry or create a fresh worktree, and some feature paths create the worktree lazily on first edit. [index.chunk-zPR7Bl2R.js:1, `getWorktreeParentDir`, `createWorktreeInScope`; index.chunk-9hgN2KD3.js:1, worktree-pool fork/start logic and lazy-worktree notice]

**Source-map correction:** the literal `git-shadow` root is implemented in **`index.chunk-DyREBOFf.js`**, not directly in `index.chunk-zPR7Bl2R.js`. It defaults to `userData/git-shadow`, creates private scratch directories, rejects overlap with session folders, builds a guarded Git environment including `GIT_DIR`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_WORK_TREE`, and conditional `GIT_INDEX_FILE`, and self-checks whether the Git binary honors the shadow layout. This is a separate guarded Git-execution mechanism, not a synonym for the user-facing worktree directory. [index.chunk-DyREBOFf.js:1, `Ce`, `Ie`, `Fe`, shadow environment]

**MAWS implication:** implement ordinary trusted Git worktrees first, with explicit ownership and safe cleanup. Study the guarded Git layer before copying it; it addresses a larger security/integration problem than simply creating an isolated checkout.

## B9. MCP ownership: app host versus CLI

Desktop has an application-side MCP hosting subsystem, including a utility-process entry `mcp-runtime/directMcpHost.js`, MessagePort-based connectivity, and legacy renderer channels such as list/connect/server-connected. The inspected direct-host startup names a “Custom 3P MCP Host”; do not claim every Code session necessarily runs every MCP server through that one path. [index.chunk-DzZc-q0x.js:7, channel enum; :13, `EAt`, `OAt`]

For Code sessions, a coordinator combines several sources: local stdio proxies, remote connector proxies, directly hosted/parked cached servers, and app-internal servers. It filters disabled tools, tracks server provenance, handles same-name collisions, records account identity, and returns a combined set. The session setup also integrates plugin-provided MCP, materialized skills/plugins, scheduled-task tools, and internal session/workspace/turn tools. Some plugin MCP config is passed to the CLI as MCP configuration rather than hosted entirely in the app. [index.chunk-CtwayTMM.js:1, `createRemoteServers`, `createAllServers`; index.chunk-9hgN2KD3.js:1, `setupMcpAndPlugins`]

The combined server set is guarded/sealed for SDK use; internal tool allowlists and prompt additions coordinate the workstation’s own operations. Live server updates can be deferred while a turn is in flight or a host is unavailable, then applied with `query.setMcpServers`; SDK statuses/errors are reconciled afterward. SDK in-process MCP uses `mcp_message` control requests and initialize-time server/manifests, whereas CLI-configured servers use the CLI’s own configuration/connection path. [index.chunk-9hgN2KD3.js:1, `guardAndSealForSdk`, `mcpServersForLiveCli`, deferred updates; index.chunk-CHNweogn.js:7, `mcp_message`, initialize payload]

**MAWS implication:** explicitly choose ownership. For an initial local workstation, let Claude Code own standard user/project CLI MCP where possible and add narrowly scoped app-owned MCP tools only for MAWS capabilities. Do not accidentally start duplicate servers or erase CLI-configured ones when pushing an app server set. Expose source, enabled state, auth status, and reconnect behavior if MAWS offers connector controls.

## B10. Renderer state and subscriptions

The preload generates methods with `ipcRenderer.invoke` and event subscriptions with `ipcRenderer.on` plus unsubscribe functions, then exposes `claude.web.LocalSessions` behind an origin gate. Main declarations include parameter/return validators. The web app aliases the service object and subscribes through the generated event API. [mainView.js:1; index.chunk-DzZc-q0x.js:13, LocalSessions declaration]

For the session list, the renderer calls `getSessionList` when present, otherwise `getAll`. It tracks load generation, archived-pending, initialization, timeout, and failed-load state, then listens with `onOnEvent`. Session-updated/close/error/start/cleared/stopped/paused/permission events update or refetch the relevant row; permission-mode and prompt-suggestion deltas have specific handling; archive/unarchive alter the list. This is a client store driven by snapshot plus events, **not a generated LocalSessions IPC store**. [shared-common-msg-1-BAHI_AaJ.js:2]

Transcript access has full/tail/page/read/port method names, while incoming manager `message` events carry live normalized messages. The helper’s pagination uses message UUID boundaries and reports cursor-not-found rather than pretending any index is stable. [services.json:1; index.chunk-9hgN2KD3.js:1, emitted `type:"message"`; index.chunk-CDfHHGGR.js:1, pagination helper]

**MAWS implication:** define a versioned snapshot/event contract with resumable identifiers and clear authority. Renderers should be replaceable subscribers, not process owners. Separate session list state, transcript projections, permission requests, task topology, Git state, file tabs, and terminal sessions even when they share a selected-session context.

## B11. Recommended MAWS starting contract

This is the implementation direction suggested by the evidence, not an additional claim about Desktop:

1. **Runtime adapter:** discover/prepare/version/health; spawn and close; capability negotiation.
2. **Session service:** create/resume/fork/archive/list; metadata/title provenance; workspace target and engine history ID.
3. **Message service:** send/queue/steer/cancel/retry; stable client IDs and acknowledgements; draft persistence separate from delivered history.
4. **Event journal/projections:** raw SDK event retention plus normalized transcript, task/subagent, usage, and liveness projections.
5. **Permission broker:** request ownership, input preview, policy reason, scoped persistence, abort and failed-delivery recovery.
6. **Workspace/Git service:** repository identity, current branch/worktree, diff, safe checkout cleanup; no destructive equivalence between archive and delete.
7. **Auxiliary resources:** independently owned PTYs, file/viewer tabs, browser/preview, and bounded side chat.
8. **App MCP tools only where necessary:** narrow capability and provenance, leaving ordinary CLI MCP ownership clear.

The next valuable step is to turn this into an explicit MAWS engine-adapter contract and a state-transition test matrix, then validate the uncertain interaction details in a live benchmark: scroll anchoring, background-tab approval routing, queued-send recovery after process exit, fork lineage, and terminal/preview process ownership. Reproducing all 307 Desktop methods would import product scope rather than the essential workstation architecture.

## Verification and remaining limits

- Both orientation notes were read first; research then used targeted service/function/test-id/copy searches rather than whole-chunk reading.
- LocalSessions method coverage was checked programmatically: 307 listed, 307 unique, no omissions or duplicate assignments; 9 events and zero stores.
- Requested adjacent service inventories were read from the source JSON.
- Main-process spawn, permission, persistence, fork, worktree, MCP, and renderer subscription paths were checked in source excerpts.
- No live sessions, IPC calls, downloads, permission changes, runtime launches, or destructive Git operations were performed.
- Static code cannot establish account-specific feature visibility, animation/scroll quality, backend sharing permissions in practice, or the current public SDK’s compatibility with every bundled private extension.
