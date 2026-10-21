# Codex desktop UX delta through 26.1016.51333

Read 2026-10-21. Comparison baseline: **26.928.40906**; intermediate builds: **26.1013.31256** and **26.1013.40934**; endpoint: **26.1016.51333**. This refreshes the reference behind [P4 smoothing](../docs/doperpowers/plans/2026-10-19-p4-smoothing.md), not its approved scope.

## Recommendation and ranking

**Refresh P4’s reference scenarios, not its feature list wholesale.** The strongest changes make ongoing work legible, preserve drafts and edits, and keep readers in place. Several conspicuous new surfaces are explicitly gated. Source presence is not evidence that the owner—or every customer—sees them.

| Rank for MAWS | Finding | Proposed destination |
|---|---|---|
| 1, immediate coordination | 51333 changes the floating surface’s no-thread dock-position bookkeeping; LC-3 must name the version actually tested | P4-B3’s outstanding LC-3 record; no automatic change to approved geometry |
| 2 | Presentation generation gains slide-local progress and following that yields to human interaction | P4-A2’s visibility reference and B2/A2’s later slide layer; follow behavior remains a product choice |
| 3 | Artifact Sessions guard rejected writes and tab closure; unsent annotation batches get explicit discard handling | P4-L editor scenarios, B1/B2 draft preservation, B3 move/close regression coverage |
| 4 | Full queued prompts become inspectable without editing; steering during compaction stays queued with an honest explanation | P4-L7; a small queue-preview candidate, and a Claude-engine probe before changing delivery semantics |
| 5 | Changes restores a file-relative reading anchor; newest builds add gated language navigation with explicit unavailable reasons | P4-L6 review scenarios; separate editor-navigation candidate, not an incidental W3 addition |
| 6 | Created-chat cards become live; Activity distinguishes unread hydration from emptiness | P4-L6 and existing W2/W3 observability debt, without expanding those batches |
| 7 | Composer predictions, Model Providers, slide Quick start, WebMCP permissions and conversational onboarding broaden the product | Explicitly gated references or later candidates; no automatic P4 additions |

MAWS already has a stronger explicit supervision contract than a completion-card stack: Needs-you separates actionable requests from unread history, identifies the owning session, and knows when the request is already visible. Preserve that. Its approved X35 provisional artifact layer also goes beyond the committed-update progress mechanism established here; do not mistake Codex’s generation-follow UI for proof of token-level provisional rendering or a measured speed advantage.

## 1. Sources, completeness and confidence

### Acquisition

`acquire chatgpt --latest` downloaded and extracted 26.1016.51333 into the toolchain’s own tree. `all` completed with **15,743 conversion records and zero failures**. The app was not installed, updated or launched. A read of `/Applications/ChatGPT.app/Contents/Info.plist` during this pass still reported **26.1013.40934**; the owner's app updated itself to 26.1016.51333 later that day. No GUI was used and no account rollout state was inspected.

The endpoint’s [BUILD.json](/Users/new/codex-app-src/extracted/chatgpt-26.1016.51333/BUILD.json) records runtime `0.0.33/20261020111233-d92591792fee`, publication at **2026-10-21 02:19:19 UTC**, and app.asar SHA-256 `9d0260dd37f9c45546d5a89d9d782b8362c9957b70b992e2c3f91df60a046b07`. Its Electron field is null; this read does not substitute a guessed Electron version.

The readable source remains outside MAWS. Links below point into `/Users/new/codex-app-src/readable/<build>/`; line numbers belong only to that named build. Stable anchors—message IDs, property names and protocol operation names—are supplied to relocate each claim in another build. Only short UI labels are quoted.

### The preliminary digest overstated removals

The 31256 conversion has exactly one failed file: `renderer/app/app-initial-3ccf4886957f.js`, recorded as `deadline`, including the no-JSX retry. See [convert-log.json:140420](/Users/new/codex-app-src/readable/chatgpt-26.1013.31256/convert-log.json#L140420). Both 40934 and 51333 have zero failed conversions.

Consequently, the preliminary 928→31256 counts of −49 routes and −53 gates are **not a product-removal story**. The 31256→40934 digest restores many of those names. Concrete 40934 routers still contain Projects and pull-request list/detail pages. This does not prove their account eligibility or sidebar discoverability stayed identical; it disproves treating missing catalog entries as sufficient evidence of removal.

Generated digests, all outside the repository:

- [31256→40934](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/CHANGES-chatgpt-26.1013.31256..chatgpt-26.1013.40934.md).
- [40934→51333](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/CHANGES-chatgpt-26.1013.40934..chatgpt-26.1016.51333.md).
- [928→40934, complete intermediate comparison](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/CHANGES-chatgpt-26.928.40906..chatgpt-26.1013.40934.md).
- [928→51333, complete endpoint comparison](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/CHANGES-chatgpt-26.928.40906..chatgpt-26.1016.51333.md).

| Comparison | UI strings added / removed / reworded | Gates added / removed | Routes added / removed |
|---|---:|---:|---:|
| 31256→40934, incomplete older conversion | 6 / 0 / 0 | 53 / 0 | 84 / 0 |
| 40934→51333 | 1,311 / 196 / 28 | 13 / 1 | 6 / 1 |
| 928→51333 | 5,060 / 1,135 / 399 | 51 / 12 | 54 / 6 |

These counts describe extracted identifiers, not numbers of user features. They include the bundled broader ChatGPT product. Gate catalogs also do not capture every minified gate helper; the component call sites are authoritative for the gates identified below.

### Outside view

The official [ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog), redirected from `developers.openai.com/codex/changelog`, announces:

- **October 1, app 26.930:** bulk move of selected chats into a project; recovery for managed-worktree attachment; large-diff zoom fixes; retries for queued messages and chats that fail to open.
- **October 7, app 26.1002:** Windows/WSL repairs, retention of the recent-chats collapsed state, and the fix for Remove from section accidentally pinning a chat.
- **October 8, app 26.1007:** queued-message Sending fixes, Steer restored in secondary windows, Changes-panel scrolling/file-navigation improvements, and clearer recovery when permissions prevent an approval request.
- **October 9:** composer predictions beta for eligible adult personal-Pro users, in local and SSH threads; accepting a suggestion creates an editable draft, not a send.

There is **no 26.1013 or 26.1016 entry** in the fetched October changelog. The public [51333 Sparkle appcast](https://persistent.oaistatic.com/codex-app-prod/appcast-26.1016.51333.xml) confirms 31256 on October 15 at 23:15:56 UTC, 40934 on October 16 at 22:31:52 UTC, and 51333 on October 21 at 02:19:19 UTC. It supplies **no release-notes URL or description for those three builds**. The Help Center release-notes page returned HTTP 403 to direct fetch; the official developer changelog supplies the usable outside view. The changelog does not establish which point build first implemented every source finding.

**Availability vocabulary used below:** “no additional gate in the component” means the behavior runs once that existing surface is reached. It is not a claim that all account, host, plugin or entitlement checks disappear. Named remote gates/layers have unknown values for the owner. No live rollout, interaction feel, IME behavior or performance bound was measured.

## 2. Thread and composer

### 2.1 Full queued-prompt inspection, separate from editing and sending

928’s queue row shows a one-line clamped Markdown excerpt. By 40934, it receives `fullMessageText` and opens a selectable, keyboard-navigable nonmodal preview containing scrollable, whitespace-preserving full text. Its accessible name includes queue position and a short excerpt. This is a new inspection affordance, not a newly introduced queue, reorder function or send mode.

Evidence: baseline [26.928.40906, queued-message-list-b1719392a450.js:653](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/queued-message-list-b1719392a450.js#L653); endpoint [26.1016.51333, queued-message-list-61cfedce4119.js:705–774](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/queued-message-list-61cfedce4119.js#L705). Stable anchors: `fullMessageText`, `composer.queuedMessage.preview.dialog.label`, `composer.queuedMessage.preview.trigger.label`.

**Availability:** no independent gate in the preview; it needs a rendered nonempty queue row and respects disabled state.

**MAWS:** better than the current truncated row in `src/renderer/src/composer/queue/QueueList.tsx`. Propose a bounded preview candidate for L7: inspecting/copying must not mutate the draft or submit it. Keep separate the existing tracker row about async-ask envelopes appearing as raw queue labels; a preview must render the human answer, not expose an implementation envelope more prominently.

### 2.2 Compaction is an explained temporary queue state

928 handles a non-sent result from the queued-message Steer action as failure. By 40934, a specific `queued` result calls `onQueued` and explains that steering cannot happen during compaction and the message remains queued. The coordinator recognizes the structured Codex error `activeTurnNotSteerable.turnKind = compact`; this is not a blanket conversion of errors into success.

Evidence: baseline [26.928.40906, app-initial-27bc4044d9e8.js:535621](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js#L535621); classifier [26.1013.40934, app-initial-90eb42395b7d.js:166930](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/app-initial-90eb42395b7d.js#L166930); endpoint [26.1016.51333, app-initial-f3e281fb9a71.js:579324](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L579324), anchor `codex.composer.queuedSteerDuringCompaction`.

**Availability:** no additional gate at this action; conditional on that transient response.

**MAWS:** import the truthfulness criterion, not Codex’s wire error. MAWS already distinguishes pending engine steers, held queue entries, uncertain delivery and paused reasons. L7 should exercise compaction/reconnection while a message waits. Any semantic change first needs a pinned Claude wire fixture under D-1/X1; A2 is not authorization for a generic queue rewrite.

### 2.3 Composer predictions are new, but not universally on

The examined 928 renderer/main trees have no `cumberbatch`, `requestUserMessagePrediction`, `composer-predictions-enabled` or `4290031608` implementation. By 40934, a mounted editor plugin offers predictions in an empty single-paragraph composer. The latest acceptance handler consumes unmodified Tab, Right Arrow or Enter, inserts the predicted document and records acceptance without sending. It explicitly declines during IME composition/keyCode 229.

Evidence: endpoint [26.1016.51333, app-initial-f3e281fb9a71.js:867452–867482](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L867452); gate/bridge [same build/file:867271](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L867271); preference [26.1016.51333, app-shared-60f4bb85435f.js:124141](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-shared-60f4bb85435f.js#L124141). Stable anchors: `composer-predictions-enabled`, `composer.prediction.pressTabToAccept`, `cumberbatch`.

**Availability:** gate `4290031608`, native bridge, local preference defaulting true, remote `is_enabled`, sampling and runtime/provider constraints. The hint has gate `2733752831`. The [40934 main-process configuration](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/main-process/main-CLu1A25j.js#L65991) is additional evidence that local default true does not mean universal deployment. Public beta eligibility is narrower still.

**MAWS:** a later product candidate, not a P4 debt fix. The useful immediate rule is that acceptance never sends and never steals the first composition event. Do not add background inference, new cost or different Enter behavior without a product decision.

### 2.4 A consolidated Location picker and global screenshot entry points

A gated Location picker replaces the separate execution-kind and target controls with one searchable menu, grouped into this computer, remotes and environments. Search flattens the submenus; remote rows expose connection state. Gate `1678134557` retains the old branch when false. Evidence: [26.1013.40934, composer-utility-bar-31c2288673e6.js:8087](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/composer-utility-bar-31c2288673e6.js#L8087), [branch:8885](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/composer-utility-bar-31c2288673e6.js#L8885); baseline [26.928.40906, composer-utility-bar-e3a99627a7ad.js:6969](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/composer-utility-bar-e3a99627a7ad.js#L6969). The implementation survives in 51333’s `composer-utility-bar-8d13457a1e00.js`.

The new `screenshotToCurrentChat` and `screenshotToNewChat` OS-global commands attach a region capture to a draft, with current-chat falling back to a new chat if no receiver is mounted. They do not introduce screenshots generally or automatically send. Evidence: [26.1013.40934, app-initial-90eb42395b7d.js:333783](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/app-initial-90eb42395b7d.js#L333783), [draft integration, app-primary-b4ce9e46e8cf.js:28854](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/app-primary-b4ce9e46e8cf.js#L28854). Availability depends on `codexOrWorkLocal`, image input, native capture and OS permission; shortcut delivery was not tested.

**MAWS:** useful composer-entry references under charter §5.4/L7. Neither remote execution nor screenshot capture is a required A2 launch-profile feature. A2’s plugin/output-style/hooks profile and Codex’s execution-location menu solve different problems.

## 3. Sidebar, projects and multi-session supervision

### 3.1 Repeated archive operations produce a scoped offer, not automatic cleanup

By 40934, ten distinct manual archives in the same sidebar group within 60 seconds can offer to archive the remainder. The account-scoped in-memory tracker offers once per group. The suggestion collects all pages of the named scope, deduplicates chats and uses the existing confirmation with running/scheduled-work warnings. Bulk archive itself predates this interval.

Evidence: baseline [26.928.40906, app-initial-27bc4044d9e8.js:358033](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js#L358033); threshold [26.1013.40934, app-initial-90eb42395b7d.js:502939–503006](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/app-initial-90eb42395b7d.js#L502939); collector [sidebar-archive-suggestion-db7fa2cc1c0a.js:82](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/sidebar-archive-suggestion-db7fa2cc1c0a.js#L82). Stable anchors: `suggestSidebarGroupArchive`, `sidebarElectron.archiveSuggestion.remainingTitle`. The threshold survives the latest raw implementation; the latest dialog anchor is [26.1016.51333, app-initial-f3e281fb9a71.js:410828](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L410828).

**Availability:** no separate numerical gate found in this suggestion; account, mode, busy/modal state and archive eligibility apply.

**MAWS:** optional L6 convenience candidate, ranked below queue readability and accurate state. Preserve MAWS’s distinction between hiding a session, stopping work, deleting a worktree and removing a project. Do not copy the ten/60-second heuristic as a requirement or describe the `codex-app-auto-archive` catalog name as proof of this offer’s automation.

### 3.2 Keyboard cycling follows eligible visible sidebar items

The old next/previous-thread handler traversed supplied thread targets. The new handler traverses `[data-sidebar-cycle-item]` rows, excludes hidden/inert/disabled/menu-popup rows, holds ordering stable through a modified-key sequence, activates the row and reveals it in its scroller. It stops at the ends; this is not a global recency switcher.

Evidence: [26.928.40906, app-initial-27bc4044d9e8.js:376175](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js#L376175); [26.1013.40934, app-initial-90eb42395b7d.js:629520–629715](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/app-initial-90eb42395b7d.js#L629520); latest query [26.1016.51333, app-initial-f3e281fb9a71.js:637040](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L637040). Stable commands remain `previousThread`/`nextThread`; labels now describe sidebar items.

**Availability:** no independent gate at the mounted handler.

**MAWS:** add an L6 keyboard scenario covering collapsed groups, filtering, hidden rows and a changing live order. It is a test/reference proposal, not a mandate to change MAWS’s established shortcut meanings.

### 3.3 Created-chat links become useful live cards

A response’s Created chat/Worktree chat card previously linked to the child without subscribing to its activity. The newer card resolves the actual title, shows Working while active and then a latest-reply preview, bounded to 120 characters for the inspected Codex path. The whole card opens the chat; removal of the old Open chat string did not remove that action.

Evidence: [26.928.40906, sites-end-resource-ef2bd7525d8a.js:6593](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/sites-end-resource-ef2bd7525d8a.js#L6593); endpoint read model [26.1016.51333, sites-end-resource-b09415607262.js:6812–6858](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/sites-end-resource-b09415607262.js#L6812), label [same file:6907](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/sites-end-resource-b09415607262.js#L6907). Stable anchor: `localConversation.appControlToolCall.createdThreadWorking`.

**Availability:** conditional on response creation results and available metadata/history; no additional gate inside the card. This is not evidence that every arbitrary session or subagent gets the same card.

**MAWS:** a stronger local reference for a linked child’s activity than an id-only/static link. It supports L6 and the existing tracker item about agent-lookup labels depending on an unrelated Agents watch. MAWS’s task graph, Needs-you and answerable Overview remain broader than these cards; do not replace them with a card feed.

### 3.4 Activity no longer calls incomplete unread hydration “nothing”

The priority empty state now distinguishes checking saved unread chats, unread chats not yet available, and genuine emptiness. The implementation creates `activity-unread:<host>` scopes and watches their pages; this is not just a wording change.

Evidence: baseline [26.928.40906, app-initial-27bc4044d9e8.js:522190](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js#L522190); latest scope [26.1016.51333, app-initial-f3e281fb9a71.js:413784](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L413784), empty-state copy [same file:690020](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L690020). Stable anchors: `sidebarElectron.activity.loading`, `.unavailable`.

**Availability:** the inherited Activity surface remains behind gate `4039078146` and access checks; this component is used when its priority section has no rows.

**MAWS:** make loading, unavailable, genuinely empty and needs-attention distinguishable in L6. This reinforces—not duplicates—the existing W1 follow-up about Background work showing a danger-coloured unknown-session error during startup. Never “fix” it by hiding real failures after startup.

## 4. Side panels, layout and IDE surfaces

### 4.1 Floating chat was already present; the latest version changes one round-trip rule

928 already supports floating chat and docking into full view, left or right panes. By 40934 its dock menu adds an explicit Minimize composer action and a grip tooltip explaining drag versus click. Evidence: inherited menu [26.928.40906, content-quick-chat-overlay-131a52374799.js:97–177](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/content-quick-chat-overlay-131a52374799.js#L97); [26.1013.40934, floating-chat-dock-menu-3a19aeaef369.js:123–153](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/floating-chat-dock-menu-3a19aeaef369.js#L123), tooltip at 192.

In 51333, the floating implementation is reorganized into `floating-chat-surface-af06c202104d.js`. There is a real, narrowly bounded state change: **when no thread key is present**, 40934 updates only the active mode’s remembered dock position and maps minimized bottom-center to bottom-right; 51333 always records the selected minimized position, updating expanded position only for an expanded move. The thread-key branch still delegates to persisted thread state, so this is not evidence that every floating-chat round trip changes.

Evidence: [26.1013.40934, quick-chat-floating-surface-fdfeb0661062.js:1304–1321](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/quick-chat-floating-surface-fdfeb0661062.js#L1304) versus [26.1016.51333, floating-chat-surface-af06c202104d.js:1505–1523](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/floating-chat-surface-af06c202104d.js#L1505). Stable properties: `dockThreadKey`, `expanded`, `minimized`.

**Availability:** an ungated branch inside the reached floating surface, conditional on absence of the thread key; the enclosing surface retains its own eligibility.

The split primitive’s local sizing/collapse implementation and constants remain materially the same after ignoring bundler-name churn: default minimum 160, collapse factor 0.5, drawer breakpoint 720. See [26.1016.51333, split-view-e7505b124d9e.js:1374–1379](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/split-view-e7505b124d9e.js#L1374). **These are primitive defaults, not a replacement for caller-specific content minimums or B3’s approved measurements.** This was not a proof that every imported helper or surrounding workspace policy is unchanged.

**MAWS:** the architect was notified immediately. LC-3 must record the installed version and cover float → move → minimize → restore, including whether the surface is thread-bound. If the owner’s app updates, do not label the resulting observation “40934.” Do not reopen D-8’s single optional split or change B3’s geometry from this source read alone.

The completion-card Dismiss and mark as read action is **not new**: its earlier implementation lives in `unavailable-local-conversation-page` in both 928 and 40934. A renamed/reorganized chunk must not become a fabricated feature delta.

### 4.2 Newest Changes adds gated language-navigation support with honest exclusions

51333 wraps diff content in language-navigation support only when gate `1932174607`, the native `lsp` bridge and cwd are present. It reads the current workspace file and enables targeting only when a displayed current-side line still matches that file. Deleted/previous lines, saved snapshots, loading content and stale text each get a specific unavailable explanation. Staged/commit/saved-turn snapshots do not pretend to be the current file.

Evidence: [26.1016.51333, thread-side-panel-tab-content-797837fb8b17.js:3559–3603](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/thread-side-panel-tab-content-797837fb8b17.js#L3559), [current-document query and reasons:4155–4207](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/thread-side-panel-tab-content-797837fb8b17.js#L4155). Stable anchors: `review-language-current-document`, `review.fileLanguage.unavailable.previous`, `.snapshot`, `.loading`, `.stale`. The corresponding wrapper/reasons are absent from the inspected 40934 Changes module.

**Availability:** explicitly gated; account outcome and language-server support unknown.

**MAWS:** for enabled users this goes beyond MAWS’s current CodeMirror/review surface. It is a separate editor-navigation candidate under charter Scene B/§5.6, not a W3 cleanup. If adopted, snapshot/current-file identity is part of the design—not optional error polish after navigation is built.

## 5. Review and diffs

### 5.1 Return to the same file-relative reading position

928 restores only a saved `scrollTop` when the diff scroller mounts. The newer code also captures a visible file’s `data-review-path` and viewport-relative offset, corrected for CSS zoom. It reapplies the anchor as children resize, stopping that correction when the human uses pointer, wheel or keyboard. This is a concrete improvement beyond saving a pixel number before asynchronous layout settles.

Evidence: baseline [26.928.40906, thread-side-panel-tab-content-5c973fe3df05.js:5472](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/thread-side-panel-tab-content-5c973fe3df05.js#L5472) (anchors `scrollContainerRef`, `tabState.scrollTop`) restores only the offset. Complete new citations are [26.1013.40934, app-initial-90eb42395b7d.js:531354–531382](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/app-initial-90eb42395b7d.js#L531354), and endpoint [26.1016.51333, app-initial-f3e281fb9a71.js:537713–537739](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L537713), [thread-side-panel-tab-content-797837fb8b17.js:6204–6242](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/thread-side-panel-tab-content-797837fb8b17.js#L6204). Stable anchors: `scrollAnchor`, `data-review-path`, `currentCSSZoom`.

**Availability:** no added rollout check in the restore logic; the parent review surface’s availability still applies.

**MAWS:** the inspected `src/renderer/src/tools/code/review/ReviewView.tsx` restores `initialScrollTop` once on mount; SCM hands it the same offset state. Codex’s semantic anchor is a stronger reference. Propose a regression scenario first: return after delayed highlighting/layout, resizing and zoom changes; the same file/hunk stays readable, and correction stops on human input. This is not an assertion that an owner-visible MAWS jump was reproduced here.

### 5.2 Review failures become actionable without claiming certainty

By 40934, unavailable GitHub resources name repository, hostname and selected login, distinguish access/SSO/app installation concerns from deletion, and pause automatic refresh until access is repaired. A bounded uncertain-write queue refuses further actions when too many previous comment/review outcomes are unknown. The source menu can report that only some related reviews loaded. PR-link onboarding explains that links now open in Codex and exposes the setting for opening them in the browser instead.

Evidence: endpoint [26.1016.51333, app-initial-f3e281fb9a71.js:244169](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L244169), [uncertain capacity:244225](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L244225), [partial results, thread-side-panel-tab-content-797837fb8b17.js:935](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/thread-side-panel-tab-content-797837fb8b17.js#L935), [PR preference, plugin-pull-request-tab-f3f0feac9b88.js:84](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/plugin-pull-request-tab-f3f0feac9b88.js#L84). Stable anchors: `codeReview.githubResource.accessRecovery.description`, `codeReview.writeRecovery.capacity`, `codex.review.pullRequests.partial`, `codeReview.pullRequestLinkPreference`.

**Availability:** behavior inside existing Code Review/provider flows; provider/host connection and account checks remain. No general-access rollout is inferred from these messages. The PR introduction is not proof that every external link is intercepted for every user.

**MAWS:** apply the principle to source-control/connector failure scenarios: partial success is not an empty list; unknown mutation outcome is not a safe automatic retry. MAWS already exposes uncertain message delivery. Keep the same honesty at other boundaries rather than adding Codex’s cloud review product to P4.

## 6. Artifacts, slides and canvases

### 6.1 Generation progress becomes spatial and interruptible

The newer native presentation editor can follow the slide receiving generation updates, keep its thumbnail visible, and show an agent/progress bubble on the slide. The progress state starts enabled for the tracked creation turn. A primary pointer interaction or ordinary key interaction in the stage/filmstrip disables following; zoom shortcuts are exempt. The avatar offers Follow ChatGPT to resume. Dismissing the progress bubble does not stop the agent.

This is actual data flow: the artifact-session binding applies old/new CRDT updates to a temporary document, finds a changed slide and updates the progress slide ID. The creation tool establishes the tracked page/turn. It is not merely six new strings in the 31256→40934 catalog.

Evidence: by 40934, [presentation-editor-30bd027c7b1d.js:72–238](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/presentation-editor-30bd027c7b1d.js#L72), [artifact-session-binding-d16e47180ee5.js:155–195](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/artifact-session-binding-d16e47180ee5.js#L155). Endpoint [26.1016.51333, presentation-editor-5e08abb82eab.js:266](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/presentation-editor-5e08abb82eab.js#L266), [same file:486](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/presentation-editor-5e08abb82eab.js#L486), [sharing-e0fda158f4a8.js:896](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/sharing-e0fda158f4a8.js#L896), [presentation-panel-6e2c3d65235b.js:21131](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/presentation-panel-6e2c3d65235b.js#L21131). Stable anchors: `presentation-creation-progress`, `creationPageId`, `pages.presentation.followChatGPT`, `pages.presentation.dismissProgress`.

**Availability:** gate `821992342`, tracked creation page/turn and suitable editor state; following is not active in grid layout or a hidden document. The gate itself existed earlier for other presentation behavior. The inspected 928 presentation editor lacks this creation-progress/follow machinery.

**MAWS:** directly relevant to A2’s perceived-work visibility and its later slide/design layer behind B2. Compare visible artifact identity, progress location, human disengagement and explicit resumption. Do **not** silently add automatic slide following to X35: MAWS’s approved reading/selection ownership remains binding. This source establishes progress on applied CRDT changes, not the provisional partial-tool-JSON layer A2 promises, and provides no timing benchmark.

### 6.2 Artifact Sessions protect persistence failures and close

928 presents a generic persistence problem/retry. Newer Artifact Sessions distinguish rejected/over-limit writes from retryable problems, refuse incompatible writes, attempt to flush CRDT updates before close, and otherwise require a keep-open/close-anyway decision. The tab registers an actual `onBeforeClose` hook.

Evidence: baseline [26.928.40906, artifact-session-tab-content.electron-dcdf41545c76.js:2564](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/artifact-session-tab-content.electron-dcdf41545c76.js#L2564); endpoint [26.1016.51333, artifact-session-tab-content.electron-7e734c6fa362.js:338](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/artifact-session-tab-content.electron-7e734c6fa362.js#L338), [close/flush:479](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/artifact-session-tab-content.electron-7e734c6fa362.js#L479), [tab hook:1499](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/artifact-session-tab-content.electron-7e734c6fa362.js#L1499). Stable anchors: `writeRejection`, `canCloseWithoutWarning`, `artifactSession.closeConfirmation.title`, `onBeforeClose`.

**Availability:** existing local-host Artifact Sessions; host/reference/creation availability still apply. No additional rollout gate was found in the inspected opener/guard.

**MAWS:** add durability-refusal/close/move scenarios to editor live tests and B3 state-carry verification. MAWS’s host-owned local-first store is different: import the invariant that an apparently updated editor is not mistaken for a durable edit, not an unnecessary copy of Codex’s persistence architecture. No MAWS data-loss reproduction is claimed.

### 6.3 Nonempty unsent annotation batches require a discard decision

The baseline forwards cancellation directly. The newer wrapper opens a confirmation only for a nonempty batch; Keep preserves it, and Discard calls cancellation with `discardChanges: true`, dismissing the confirmation only after accepted cancellation.

Evidence: baseline [26.928.40906, artifact-annotation-batch-controls-ce0c8fd38aed.js:1086](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/artifact-annotation-batch-controls-ce0c8fd38aed.js#L1086); [26.1013.40934, artifact-annotation-batch-controls-553784965e46.js:1238](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/artifact-annotation-batch-controls-553784965e46.js#L1238); endpoint [26.1016.51333, artifact-annotation-batch-controls-9c3b19782181.js:654](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/artifact-annotation-batch-controls-9c3b19782181.js#L654), [discard:1361](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/artifact-annotation-batch-controls-9c3b19782181.js#L1361). Stable anchor: `artifactAnnotations.exit.title`.

**Availability:** no additional gate in this control; parent annotation-mode eligibility applies. These are unsent agent annotations, not ordinary persisted comment threads.

**MAWS:** supports B1/B2’s already-approved draft preservation and layered Escape rules. Preserving the draft is stronger than silently discarding it; no new confirmation should replace a preservation behavior that already works.

### 6.4 Slide text activation moves to committed pointer-up; it does not settle IME

928 already has select-first and a remembered text element for the subsequent click. By 40934, inactive bookmarked text activates at committed pointer-up only when movement is within two screen pixels and the same text element remains singly selected. Double/triple click retain word/paragraph behavior; Enter still enters at block end in the inspected handler.

Evidence: baseline [26.928.40906, presentation-panel-80ed85a47fff.js:9338](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/presentation-panel-80ed85a47fff.js#L9338); [26.1013.40934, presentation-panel-3dfaa251eed9.js:10679](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/presentation-panel-3dfaa251eed9.js#L10679), [pointer-up:11173](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/presentation-panel-3dfaa251eed9.js#L11173), [Enter:11458](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/presentation-panel-3dfaa251eed9.js#L11458). Stable anchor `armedTextElementIdRef` survives in 51333’s `presentation-panel-6e2c3d65235b.js`.

**Availability:** conditional on an editable presentation; no new interaction-path gate established.

**MAWS:** preserve B2’s approved select-first design and its IME arrangement. Codex’s “armed” variable is a selection bookmark; it is not evidence of MAWS’s already-mounted, focused editable ARMED state or an intact first Hangul syllable. No distinct new design-board interaction model was established; shared inspector code is not proof of one.

## 7. Settings, onboarding and new browser surfaces

### 7.1 Model Providers: substantial new settings, behind a gate

51333 adds custom gateway and Bedrock Runtime/Mantle provider forms, managed/config-origin protections, config writes, an active-loaded-thread guard and app-server restart/catalog refresh. A connection test uses an ephemeral read-only thread with tool capabilities disabled rather than the active user chat. The default-provider setting describes new chats; existing chats retain their provider.

Evidence: [26.1016.51333, settings-b4ea2d75c11d.js:2303](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/settings-b4ea2d75c11d.js#L2303), [busy guard:2348](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/settings-b4ea2d75c11d.js#L2348), [restart:2467](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/settings-b4ea2d75c11d.js#L2467), [isolated test:2623](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/settings-b4ea2d75c11d.js#L2623). Stable anchors: `settings.gateways.*`, `config/batchWrite`, `settings.gateways.test.button`, `settings.gateways.restart.notice`.

**Availability:** gate `623263923`; visibility additionally waits for state to resolve and the section belongs to `codexLocal`. See [use-visible-settings-sections-e7b8e06f633a.js:1338](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/use-visible-settings-sections-e7b8e06f633a.js#L1338), [visibility:1744](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/use-visible-settings-sections-e7b8e06f633a.js#L1744). Not present as this workflow in 928/40934.

**MAWS:** useful C11/X6 reference for effective-versus-requested settings, protecting running work and isolated tests. It does not authorize changing D-1’s engine architecture, the gateway policy or A2’s launch-profile scope.

### 7.2 Slide Quick start: three entry paths, no automatic send

51333 can open a new-slide modal with Start from scratch, Create from a file and Create from spaces. Scratch closes it. File choices attach to the correct page composer and prefill an editable, unsent request. The actions depend on real composer/file-action readiness and account/page identity, not just the existence of an upload button. Earlier builds simply created the page and navigated into it.

Evidence: [26.1016.51333, dialog-39e0c19cddc2.js:51](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/dialog-39e0c19cddc2.js#L51), [file actions:122](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/dialog-39e0c19cddc2.js#L122), [choices:246](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/dialog-39e0c19cddc2.js#L246), [mount, space-page-b3328b166fc0.js:1406](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/space-page-b3328b166fc0.js#L1406). Stable anchors: `PresentationQuickStartDialog`, `pages.presentation.quickStart.filesPrompt`, `composer.addFiles`, `attachLibraryFiles`.

**Availability:** creation writer checks `granola_presentation` and layer `2232827372`, parameter `show_new_slide_quick_start_modal`: [app-initial-f3e281fb9a71.js:721724](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L721724). Gate outcome unknown.

**MAWS:** a later creation/onboarding candidate under the artifact charter, not a prerequisite for B2’s editor smoothing. The immediately reusable principle is an inspectable draft after attachment, not an implicit model turn.

### 7.3 Site-provided browser tools become a permission dimension

By 40934 the website-permissions matrix includes `webMcp`, live default-toggle mutations and per-origin behavior. A global default does not erase stored site-specific permissions; managed restrictions can disable controls with a reason. The 928 matrix lacked this dimension.

Evidence: [26.1013.40934, browser-use-policy-site-permissions-f412242dc645.js:563](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/browser-use-policy-site-permissions-f412242dc645.js#L563), [policy handling:740](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/browser-use-policy-site-permissions-f412242dc645.js#L740), [default mutation, settings-plugin-controls-80a9380408d3.js:437](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/settings-plugin-controls-80a9380408d3.js#L437). Stable anchors: `settings.browserUse.sitePermissions.siteTools`, `webMcp`. Endpoint availability logic: [26.1016.51333, app-initial-f3e281fb9a71.js:823647](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/app-initial-f3e281fb9a71.js#L823647).

**Availability:** internal build, gate `1256703444`, or managed `browserUse.allowWebmcp`; browser-settings availability also depends on `in_app_browser`. Not an ungated new capability for every user.

**MAWS:** permission-vocabulary prior art for browser/connector boundaries. Do not revive removed browser-tool scope or implement WebMCP as a side effect of W2 browser-shared fixes.

### 7.4 Conversational desktop onboarding

Role selection itself existed in 928. The newer desktop-setup step starts a real onboarding conversation, handles dispatch acceptance/failure, classifies role answers and supplies starter tasks. Its kickoff is marked visually hidden from conversation; Skip loads tasks without changing the stored role.

Evidence: baseline role workflow [26.928.40906, onboarding-page-819fb45c5266.js:1719](/Users/new/codex-app-src/readable/chatgpt-26.928.40906/renderer/app/onboarding-page-819fb45c5266.js#L1719); endpoint [26.1016.51333, step-72532462fae1.js:244–295](/Users/new/codex-app-src/readable/chatgpt-26.1016.51333/renderer/app/step-72532462fae1.js#L244). Stable anchors: `desktop_setup`, `onboarding:desktop_setup`, `requireDispatchAcceptance`, `is_visually_hidden_from_conversation`. The 40934 [wrapper eligibility](/Users/new/codex-app-src/readable/chatgpt-26.1013.40934/renderer/app/onboarding-page-b0057625e2d6.js#L3719) also limits mounting to the enabled role phase.

**Availability:** eligibility-gated, with kickoff gate `3294441402`; the full account eligibility chain was not evaluated live.

**MAWS:** low-priority prior art, not a reason to add hidden model turns to first launch. Its owner/colleague workstation audience and explicit launch/trust flow are different from general-consumer role discovery.

Other latest catalog leads include browser password-manager setup and biometric enrollment. They were not promoted to shipping findings: this pass did not establish their complete desktop reachability/rollout. Billing, commerce, consumer identity and terminology-only strings are not evidence that MAWS’s baseline needs thousands of new controls.

## 8. Proposed flow-back—no spec or tracker edits made

| Proposal | Owner/scope | Closing evidence or decision |
|---|---|---|
| Record exact Codex build in LC-3; add move/minimize/restore and distinguish thread-bound from standalone float | P4-B3’s outstanding live check | Owner-run observation on the named installed build; update the reference pin if it changed, not the approved constants by assumption |
| Add generation-progress/follow reference to A2 and the later B2-dependent layer | P4-A2, P4-B2; L decks/designs | Compare first visible work, artifact identity and human interruption. Automatic following requires an explicit product decision; X35’s no-persistent-write provisional rules remain intact |
| Exercise rejected persistence and unsent annotation drafts across close, Escape and surface transfer | B1/B2/B3 plus P4-L editors | A failed save is visible and cannot be bypassed by move/close; nonempty drafts survive or require an explicit discard choice |
| New candidate: full queued-prompt preview, separate from Edit/Send | L7 / composer | Keyboard-openable/selectable full human-readable prompt; no mutation or submission on inspection. Existing async-ask envelope row remains a separate requirement |
| New candidate: semantic review-scroll restoration | L6 / review | Same file/hunk remains readable after delayed layout, zoom and return; correction yields immediately to human input. First reproduce against MAWS’s offset-only restoration |
| Reuse observability scenarios for the existing startup/agent-label/queue-label rows | Existing W2/W3 ownership; L6/L7 | Read the exact tracker row before assigning work. The false-startup-danger and agent-lookup-watch rows are not authorization for a new dashboard |
| Keep predictors, LSP navigation, providers, slide Quick start and archive heuristics as separate candidates | Architect/owner product decisions | Define desired behavior and engine/service support first; none silently joins a debt wave |
| Toolchain candidate: reject or prominently mark incomplete comparisons | `~/app-source-tools/src/diff.mjs`, `diffBuilds` preflight | Inspect both `convert-log.json` files before calling catalog differences additions/removals; failing conversions must prevent an unqualified digest. Preserve the failed files/build names in diagnostics |

**W2/W3 boundaries matter.** W2’s remaining renderer/browser and service work is row-bounded. W3-A covers editor/export residue; W3-B covers measurement work, with later measurement rows waiting on B2. Neither wave is a catch-all for newly discovered Codex features. Use this research to strengthen the relevant scenarios and register separately approved scope, not to recut active workers by implication.

## 9. Verification and remaining limits

- Latest acquisition and all stages completed; 51333 has zero failed conversions. The installed app read 40934 during this pass and has since updated itself to 51333.
- Required point-release digests and complete-endpoint digests exist outside MAWS. No vendor source was added to the repository.
- Behavioral findings were traced to components/controllers and compared with baseline implementations; catalog strings were only discovery leads. Lower-ranked untraced surfaces are explicitly excluded above.
- No GUI, native-input, owner-account gate check, live service mutation, engine probe or performance test was performed. Source evidence cannot close LC-3 or B2’s S-IME check.
- `research/SOURCES.md` received an independent low-rung correctness review with no material findings. That review covered the inventory/completeness warning, not an independent audit of this entire research document.
- Reusable friction: `ast diff` silently accepts incomplete conversions; the worktree validator also rejected several long read-only catalog commands, worked around with short commands or a script file. The existing MAWS friction entry covers the latter. Help Center direct fetch returned 403; official changelog/appcast plus component sources provided the usable evidence. These are proposed tracker updates for the architect, respecting this assignment’s no-tracker-edit boundary.

### Public sources

- [Official ChatGPT & Codex changelog](https://learn.chatgpt.com/docs/changelog).
- [Public 26.1016.51333 appcast, including both 26.1013 releases](https://persistent.oaistatic.com/codex-app-prod/appcast-26.1016.51333.xml).
- [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes): direct fetch was blocked; the October 9 predictions announcement was also discoverable through search and the official changelog.
