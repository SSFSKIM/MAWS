# MAWS versus Codex, Claude Desktop Code and T3 Code — initial assessment

Parent: `docs/charter.md`, cross-cutting C1–C12; parent pin `35d8c3d1fd65fad2273134c47f72c576e1468f73`. MAWS baseline `a2dca3a0`. Date: 2026-10-01. Reproductions and evidence boundaries: [ledger](ledger.md). Method and remaining matched scenarios: [assessment method](../../plans/2026-10-01-comparative-app-assessment.md).

## Position

**MAWS has working core interactions, but this pass does not establish production-product parity or daily-driver readiness.** The most consequential freshly reproduced UX issue is a split layout that visually loses Settings controls. The most concrete correctness issue is conflicting repository identity: `HEAD` in the header/composer/Overview card for a folder that Session overview correctly recognizes as non-Git.

MAWS's actual strengths should not be obscured by those findings: the real-engine question reached a native form, appeared as actionable cross-session attention, could be answered directly from Overview, cleared its pending state, and returned the selected answer. Native terminal cwd and file viewing worked; a renderer reload retained the draft, transcript and terminal output. These were exercised, not inferred from component names.

Equally, reference products are not presumed perfect. The installed T3 0.0.40 surfaced raw engine event text and question JSON in its transcript. Its installed Alpha build, upstream stable 0.0.44, and current-main source are three different evidence targets.

## What can be rated now

**No defensible overall numeric rating yet.** The five declared matched end-to-end scenarios have not been completed (0/5 per product). This first pass established narrower native behaviors and actionable findings, not a complete comparative benchmark. An average here would reward whichever product happened to receive easier checks and would hide blocked Codex access.

| Narrow observed outcome | MAWS | Claude Desktop Code | Installed T3 | Codex surface |
|---|---|---|---|---|
| Synthetic no-tools first response returned | Observed success | Observed success | Observed success | Blocked live access |
| Structured Alpha/Beta question → Beta → returned answer | Observed success; answered from Overview | Observed success; one-click selection submitted | Observed success; one-click selection submitted | Blocked live access |
| Non-Git workspace identity | Conflicting `HEAD` vs non-repository labels | Not comparable: no-folder session | Explicit Initialize Git, no branch chip | Not tested |
| Native terminal cwd and fixture-file viewing | Observed success in scratch directory | Not tested | Not tested | Blocked live access |
| Default narrow split Settings readability | Visibly clipped values/controls | Not tested | Not tested | Blocked live access |
| Renderer reload restores draft/history/tool tabs/output | Observed success in idle session | Not tested | Not tested | Blocked live access |

These outcomes are not ratings of their encompassing A1–B6 categories. Profiles, models, windows and themes were not normalized; no human timing, discovery test, or owner preference judgment has occurred. Owner-specific usability remains unestablished.

## Prioritized findings

### M-01 — Settings is visually unusable in the ordinary narrow split

**Priority:** P2, meaningful deep-work UX defect. **Evidence:** observed, high confidence for this layout. **Scope:** Scene B, D-8/P0 split and settings. Existing acceptance issue freshly reproduced, not a newly discovered regression.

- **Reproduce:** normal scratch launch, sidebar and auxiliary panel at their defaults → Cmd+, → Cmd+backslash.
- **Expected:** essential values and controls remain visible/reachable through an understandable responsive layout, or the app clearly constrains the unsupported arrangement.
- **Actual:** navigation and field labels remain, but Engine values and controls are outside the visible Settings pane. An otherwise empty auxiliary panel still occupies substantial width.
- **Limit:** accessibility activation of the invisible Change… control opened the picker. This is visual clipping, not proof that every access route is blocked. Returning to one pane restores visibility.
- **Recommendation:** fix the form's narrow-width behavior and establish a minimum usable layout contract. Compare alternatives with the owner before changing the broader split model; hiding all auxiliary panels automatically is not assumed to be the right product decision.
- **Reference boundary:** no matched reference split-settings test; this fails MAWS's own usable-split expectation without needing to claim competitors always behave better.

Evidence: [split screenshot](shots/maws-settings-split.jpg), ledger N5; prior `docs/doperpowers/evidence/c12/owner-results.txt` and `recomposition.txt` already leave narrow-split acceptance open.

### M-02 — Non-repository sessions acquire a misleading `HEAD` branch

**Priority:** P2, workspace-state correctness/clarity. **Evidence:** native UI plus source trace; high confidence in the contradictory display, medium in the exact producer of the metadata.

- **Reproduce:** add a fresh non-repository folder → first real turn → wait for indexing/title completion.
- **Actual:** header, composer and Overview card show `HEAD`; session summary correctly says Not a git repository. Runtime log contains `NotARepositoryError`.
- **Impact:** a person cannot rely on consistent workspace identity when deciding whether/where changes are isolated. No wrong-directory write or data loss was observed.
- **Mechanism:** header renders stored branch; composer falls back to recorded branch when its Git watch has no branch, including a failed non-repository watch. Summary separately renders the authoritative error. Transcript indexing accepts reported `gitBranch` without repository validation. Exact transcript branch producer was not inspected in this pass.
- **Recommendation:** distinguish “not yet known” from “known non-repository” and make displayed repository identity consistent. Do not interpret the sentinel `HEAD` as a verified branch in this state.
- **Reference:** T3's same synthetic folder displays Initialize Git without a branch claim. Claude's no-folder session is not a matched comparator.

Evidence: [contradictory state](shots/maws-nonrepository-metadata.jpg), [Overview](shots/maws-overview-question.jpg); `src/renderer/src/app/Toolbar.tsx:19`, `src/renderer/src/composer/frame/bindings.ts:117`, `src/renderer/src/composer/frame/git-watch.ts:9`, `src/renderer/src/panel/summary/Environment.tsx:13`, `src/main/index/sessions.ts:210`. Separate tests cover non-repository summary and record-based header behavior, not their contradictory combination.

### M-03 — Creating a session does not hand keyboard focus to its composer

**Priority:** P3, recurring interaction friction; not a blocked task. **Evidence:** native AX plus source trace; one observed project-button path.

- After clicking New session in project, the tab opened but focus remained on that sidebar button. An explicit editor click was needed before composing.
- T3's new synthetic project/thread focused its composer. This is useful reference behavior, not a full keyboard benchmark.
- `ProjectGroup.tsx:60` invokes session creation; `keymap/actions-runtime.ts:38` activates the tab but does not transfer editor focus. `composer/editor/Editor.tsx:88` has no autofocus. The existing new-session E2E explicitly clicks the editor (`e2e/sessions.spec.ts:92`), so it cannot catch this friction.
- Recommendation: deliberately hand off focus on new-session creation, preserving reasonable exceptions such as pending setup interactions. Verify the native keyboard loop rather than adding only a component-presence assertion.

Not generalized to every new-session path or every focus shortcut. A separate rapid batched shortcut attempt was inconclusive and is excluded.

### M-04 — User-facing labels revert to engine/implementation vocabulary

**Priority:** P3, presentation debt. **Evidence:** native UI and source trace.

- Sonnet 5 · medium became `claude-sonnet-5-5[1m] · medium` after the first turn. In a narrow split the long ID wrapped inside the toolbar. This is not evidence that the wrong model ran.
- Composer uses the resolved ID, then exact catalogue matching, with an intentional raw fallback. Summary always uses the raw identity. The observed resolved ID differs from the older checked-in wire fixture's `claude-sonnet-5[1m]`; live catalogue contents were not inspected, so the precise mismatch is not proven.
- Permission menu labels expose `default`, `acceptEdits`, `bypassPermissions`, despite useful descriptions. The model widget's normal footer exposes wire request names. Settings exposes charter label D-19.
- Claude and T3 retained friendly model names in these observed turns; T3's Supervised/Auto-accept edits labels also explain the user's choice without API spelling.
- Recommendation: keep exact identities available in details/diagnostics but make routine control labels stable and human-readable. Preserve the honest raw fallback for genuinely unknown gateway models.

Evidence: [first-turn model label](shots/maws-nonrepository-metadata.jpg), [narrow composer](shots/maws-file-split.jpg); `src/renderer/src/composer/frame/ModelChip.tsx:17`, `bindings.ts:46`, `src/renderer/src/panel/summary/Environment.tsx:31`, `src/shared/sessions/models.ts:24`.

### R-01 — Installed T3 leaks engine internals into the normal transcript

**Priority:** reference-product P3 observation, not a MAWS defect. **Evidence:** direct installed-app observation.

The no-tools first turn displayed `Claude system message 'ui_invalidate' — event: ui.render`. While awaiting the question, the tool summary displayed a raw JSON argument prefix. The desired answer and question submission still worked. This is a reason to evaluate reference interactions rather than copy every visible implementation detail.

Evidence: [T3 first turn](shots/t3-first-turn-cropped.jpg), [T3 question](shots/t3-question-cropped.jpg). Do not attribute this to stable 0.0.44 or current upstream source without reproducing there.

## Competitive coverage, distinct from defects

This is a **scope/documentation matrix**, not a live parity score. “Documented/source” does not establish current runtime availability or quality. Reference URLs below were researched during this session.

| Capability | MAWS P0 / roadmap | Codex current docs | Claude Desktop Code current docs | T3 research snapshot |
|---|---|---|---|---|
| Multi-session attention and navigation | Needs-you/Overview; single live question observed | Activity when available, alerts, next-attention navigation | Project/status/environment filters, session splits, task pane | Attention-state precedence, stable ordering, settle/snooze/archive; source-backed |
| Queue/steer/stop semantics | App-owned durable queue in scope; not live-tested here | Follow-up setting distinguishes steering vs waiting | Immediate Stop vs correction after current action; full queue details mainly prior source research | Queue/Steer documented; current web/desktop queue explicitly in-memory, not restart-durable |
| Review and precise follow-up | Diff scopes/viewer in P0; staging/commits P1 | Scope-aware diff, line feedback, staging/reverting | Diff feedback, review findings, editable file pane, terminal | Diff/file/terminal/source-control/context-chip documentation and source |
| File editing | Read-only P0; editor P1 | Deep-work surfaces documented; do not infer parity from a file-tree label | Local/SSH editing with conflict warning documented | File surfaces documented; provider/client constraints apply |
| Integrated browser | P1 | App/browser-related workflows documented, not exercised here | Browser pane documented | Browser surface directly visible; operation untested |
| Session survival/recovery | No process survival across app quit in P0; explicit resume | Local/cloud modes differ; do not infer restart persistence | Local/cloud differ; cloud continuation is not local survival | Continue-after-restart optional/off by default, supported saved provider state required |
| Extensions/owner-specific rendering | Post-P0; to-human lane P1/extension-dependent | Different product scope | Same engine family, host-specific wiring | Multi-provider/mobile/remote breadth is not a MAWS P0 requirement |

The meaningful competitive gap is the **complete review → precise feedback → verification loop**, not simply missing tabs. MAWS deliberately defers editable files, source-control mutations and browser integration. Those decisions explain the gaps; they do not make them disappear for a person deciding which app to use.

## Research provenance and sources

### Codex and Claude Desktop

Official docs fetched by the reference-research agent on 2026-10-01. Former OpenAI Codex app URLs now redirect into combined ChatGPT desktop documentation; use its **Codex** surface, not generic Chat/Work. Anthropic's comparison target is **Code**, not Chat/Cowork or assumed CLI parity. Account, policy, model, feature flag and platform qualifications still apply.

- [Codex execution modes](https://learn.chatgpt.com/docs/environments/modes), [worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees), [projects/chats](https://learn.chatgpt.com/docs/projects)
- [Codex attention/notifications](https://learn.chatgpt.com/docs/notifications), [commands](https://learn.chatgpt.com/docs/reference/commands), [permissions](https://learn.chatgpt.com/docs/permission-modes), [follow-up settings](https://learn.chatgpt.com/docs/reference/settings)
- [Codex review](https://learn.chatgpt.com/docs/code-review?surface=app), [terminal](https://learn.chatgpt.com/docs/integrated-terminal), [troubleshooting](https://learn.chatgpt.com/docs/reference/troubleshooting)
- [Claude Desktop Code reference](https://code.claude.com/docs/en/desktop), [quickstart/product distinctions](https://code.claude.com/docs/en/desktop-quickstart)

Claude docs specify local-only terminal, local/SSH file editing, and minimum versions for newer panes. Codex docs disagree on Cmd+K precedence in a terminal; do not assert it as a universal reference binding without live verification. Rich transcript grouping and full queue UI claims also draw on **prior static repository research**, not these native tests: `research/codex-thread-ux.md`, `research/codex-shell-ux.md`, `research/claude-desktop-ux-and-engine.md`.

### T3 Code

- Installed observed binary: 0.0.40 Alpha, correspondence to upstream tag unverified.
- Latest stable identified by public research: [v0.0.44](https://github.com/pingdotgg/t3code/releases/tag/v0.0.44), commit `451afcb22d93f06cb24f9bc16703404564952553`, published 2026-09-29.
- Current-main research pin: [`148e6deea046658639aae9fef5b349781cec39d1`](https://github.com/pingdotgg/t3code/commit/148e6deea046658639aae9fef5b349781cec39d1). Includes unreleased work. README still calls the product very early and warns to expect bugs.
- Pinned documentation: [threads](https://github.com/pingdotgg/t3code/blob/148e6deea046658639aae9fef5b349781cec39d1/docs/user/thread-sidebar.md), [composer](https://github.com/pingdotgg/t3code/blob/148e6deea046658639aae9fef5b349781cec39d1/docs/user/composer.md), [source control](https://github.com/pingdotgg/t3code/blob/148e6deea046658639aae9fef5b349781cec39d1/docs/user/source-control.md), [updating/recovery](https://github.com/pingdotgg/t3code/blob/148e6deea046658639aae9fef5b349781cec39d1/docs/user/updating.md), [keyboard focus](https://github.com/pingdotgg/t3code/blob/148e6deea046658639aae9fef5b349781cec39d1/docs/user/keyboard-focus.md).
- Pinned implementation: [attention precedence](https://github.com/pingdotgg/t3code/blob/148e6deea046658639aae9fef5b349781cec39d1/apps/web/src/components/Sidebar.logic.ts#L975-L1064), [in-memory queue](https://github.com/pingdotgg/t3code/blob/148e6deea046658639aae9fef5b349781cec39d1/apps/web/src/queuedMessageStore.ts#L124-L125), [diff panel](https://github.com/pingdotgg/t3code/blob/148e6deea046658639aae9fef5b349781cec39d1/apps/web/src/components/DiffPanel.tsx).

Limits worth carrying into testing: import omits tool activity/attachments and caps visible history; queues differ between desktop/web and mobile; providers differ in rewind/resume; preserved terminal output does not establish preserved processes. None of the upstream reliability/performance claims were live-tested by the research agent.

## Next assessment tranche

**Continue assessment, not fixes.** Prior MAWS acceptance records already leave reference comparison, split feedback and native hands checks open. Highest value now:

1. Run the five pinned matched scenarios, beginning with a real small code change/diff/terminal verification loop and simultaneous scoped requests. Use identical scratch snapshots and independent filesystem/process truth. Do not substitute more first-turn checks for these.
2. Have the owner perform a short supervision/deep-work sitting to judge unaided navigation, density, split proportions and interaction preferences. The outstanding question is which concrete workflow currently drives them back to a reference app.
3. Obtain a permitted Codex observation path or owner-provided walkthrough; retain the live-access blocker until then. Do not bypass the tool refusal.
4. Separately verify actual owner configuration, CLI interoperability/foreign-live protection, queue/steer/stop and recovery gates. Preserve historical acceptance evidence as historical rather than rerunning every green suite indiscriminately.

No product redesign, implementation fix wave, upstream report, push or PR is part of this initial assessment artifact.
