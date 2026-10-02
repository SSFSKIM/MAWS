# Comparative app assessment — 2026-10-01

Parent: `docs/charter.md`, P0 cross-cutting assessment of C1–C12 (not a new implementation child). Parent pin: `35d8c3d1fd65fad2273134c47f72c576e1468f73`. Baseline: `a2dca3a0`. Branch: `worktree-app-assessment-2026-10-01`.

## Purpose and boundaries

Determine whether MAWS is a credible daily-driver replacement for the owner's coding-agent apps, with equal weight on cross-project supervision (Scene A) and deep work in one session (Scene B). Compare with Codex desktop for interaction quality, Claude Desktop **Code** for the same-engine host experience, and T3 Code for an additional implementation and interaction reference. Do not assume that a reference product is correct merely because it ships.

This initiative produces assessment evidence and a prioritized gap report, not product fixes, charter changes, or an unsolicited implementation wave. Existing acceptance records are leads and historical evidence, not fresh passes. The original checkout's untracked evidence is outside this worktree's baseline and is not silently incorporated.

## Evidence discipline

Every conclusion identifies its evidence class:

- **Observed:** native UI behavior exercised during this assessment, recording version, preconditions, actions, result and evidence locator.
- **Automated:** tests run during this assessment, including exact suite and harness conditions. Replay/stub behavior is not proof of a live engine round trip.
- **Source-backed:** implementation inspected at a specified revision. Presence is not execution success.
- **Documented:** vendor documentation, release notes, repository README, or prior MAWS acceptance records. State the source and version/date limits.
- **Unverified/blocked:** missing access, state, fixture, permission, or test. Never convert unknown to pass, failure, or zero.

Separate observed fact from evaluator judgment and inferred cause. A button's presence proves discoverability, not the action's success. A single successful run proves a case, not reliability. Do not score model intelligence or model speed as app quality; distinguish host latency from inference latency. A model/task failure without evidence of a host failure is a confounded, unscored outcome. Native automation time is not a measurement of human task time.

Execution status is recorded in `docs/doperpowers/evidence/app-assessment-2026-10-01/ledger.md`. The initial exploration includes real first-turn/question round trips in three apps and narrow MAWS file/terminal/reload checks. These are not completion of the five matched scenarios or the replacement gates below; those remain planned assessment work, not claimed passes.

Record installed and researched versions separately. Do not update reference apps during the baseline pass. Do not send private histories, credentials, real project content, or evidence bundles to public services. Use synthetic scratch projects for new turns and file modifications. Do not interrupt existing work or change global app preferences merely to manufacture comparability.

## Comparison method

Compare the same scenario variant and independently checkable outcome, not identical UI steps. A broad task ID is a coverage category, **not a matched scenario**. Allow each product's native path, including supported external editor/terminal handoffs; record the path and any friction rather than requiring MAWS's layout. Evaluate installed products first, supplementing with documented capabilities where live access is unavailable.

Before a run, record a short scenario card: scenario/variant ID; exact prompt or user action; scratch fixture and initial commit; independent truth/oracle; starting sessions and state; account/provider/model and permission/trust conditions; locale/theme/window size; required completion criteria and stopping point. Hold the goal, fixture contents, session count/state and criteria fixed across compared runs. Record unavoidable environment differences and their limits; a materially different precondition, oracle, or evidence mode makes a separate, unmatched variant. Do not change global preferences or existing work to force a match.

### Task coverage map

| ID | Scene | User goal | Success evidence |
|---|---|---|---|
| A1 | A | Return after several sessions ran and identify where intervention is needed | Correct project/session and reason visible; actionable attention state distinguished from unread completion |
| A2 | A | Answer a question/permission/plan in one session without acting on another | Correct target, scoped action, pending state retires truthfully, background work remains intact |
| A3 | A | Find and switch among sessions across projects | Search/filter/navigation understandable; selection and drafts retained; keyboard focus follows visible context |
| A4 | A | Inspect child agents and background work | Parentage, progress, terminal states and available control semantics are truthful |
| A5 | A | Leave and return after reload/restart/failure | In-flight limitations disclosed; resumable history, draft and pending-state reconciliation checked |
| A6 | A | Notice attention while unfocused | Notification and next-attention affordance lead to the right context without accidental approval |
| B1 | B | Start a task in the intended directory/worktree and mode | Location, model, effort, permissions and trust understandable before first send; first turn completes |
| B2 | B | Read the answer and inspect how it was produced | Streaming, completed answer, tool details/errors and long output readable; scroll position stable |
| B3 | B | Send a follow-up, queue or steer while working, then stop/resume | Labels predict semantics; no lost/duplicated input; queue and interrupted state visible |
| B4 | B | Review exactly what changed | Scope understandable; file list and diff agree with scratch git truth; path opens expected file |
| B5 | B | Use file and terminal surfaces without losing session context | Correct cwd/worktree, useful keyboard navigation, readable output, retained layout/session association |
| B6 | B | Recover from an error or interrupted task | Partial work preserved; error actionable; retry/resume does not silently repeat unrelated effects |

### Small initial scenario set (planned, not execution evidence)

Prepare local synthetic fixtures and a truth manifest outside the app UI before running these five variants. Pin their contents/scripts and exact prompts in the ledger; do not infer expected state from a sidebar label or the agent's claim. Native setup may differ, but must produce the recorded preconditions. If a state cannot be prepared or verified in a product, record that limit rather than substituting a different task and calling it matched.

| Variant | Coverage | Fixed starting state and action | Independent completion criteria |
|---|---|---|---|
| S1-attention | A1, A3 | Two scratch projects, two named sessions each: one working at a controlled checkpoint, one awaiting a benign permission, one completed but unopened, one completed and opened. Start outside those sessions; identify and open the one requiring intervention without answering it. | Preparation log and process/transcript events identify the four states. Selected project/session and permission reason match that manifest; unread completion is not mistaken for intervention; no request is answered. |
| S2-scoped-approval | A2 | Two named scratch sessions each await permission to create its own distinct sentinel file. Open the specified session and approve only that request, without a broader grant, using the native response. | The specified sentinel has the predefined content, its request retires, no broader grant is made, and the other sentinel remains absent with its request still pending. Corroborate with request/producer logs and filesystem truth, not only the UI. |
| S3-first-follow-up | B1, B2, B3 | Clean pinned scratch repository with `label.js` exporting a deliberately wrong `label` function and `label.test.js` requiring `label('  Blue  ') === 'blue'`. In the recorded directory/model/mode/trust state, send: “Change only label.js to export const label = (value) => value.trim().toLowerCase(); then run node --test.” Follow with: “What test command ran, and what was its exit status?” | An independent `node --test` run passes; git truth shows only the specified implementation change in the intended repository; first response and follow-up are present once and agree with the recorded command/result. The prescribed edit avoids grading code-generation taste or intelligence. |
| S4-review-context | B4, B5 | Same pinned scratch snapshot with one fixed tracked-file modification and one fixed untracked file, associated with the selected session. Review both changes, open the named file, and check the working directory through the product's native file/terminal route. | File list and displayed changes agree with external `git status`/diff and file contents; the named file and reported cwd refer to the intended scratch repository; the session context is retained on return. |
| S3-interrupted | B3, B6 | Separate recovery variant: the same scratch task has made one known allowed change, then a controlled read-only command is held at a recorded checkpoint. Interrupt there, preserve the partial state, and resume with the fixed completion prompt. | Checkpoint/termination logs establish the interruption; partial change survives; the independent test passes after resume; transcript and filesystem checks show no lost/duplicated input or unrelated repeated effects. |

Replay/stub variants may establish UI behavior, but are distinct from real-engine variants and cannot satisfy live replacement gates. Compare and rate **only executed, matched variants** with the same evidence mode and material preconditions. Unmatched native exploration, setup/menu observations, source inspection and documented capabilities remain useful **unscored findings**, not pairwise quality scores. Recovery, restart, error and keyboard-only paths are separately named variants when exercised; they are not implied by a happy-path pass.

Cross-cutting checks: empty states, visual hierarchy, useful information density, disclosure and feedback, keyboard-only operation, accessible names/focus, narrow-window behavior, and honest unsupported states. Record which were actually exercised rather than expanding every initial scenario into a full test suite. New live agent turns require a prepared synthetic task and a permitted authenticated provider path.

### Rating rubric

Score functionality and evaluator UX judgment independently for **executed, matched scenario variants only**. Functionality rates the predefined outcomes, not how many edge cases were attempted. Record test breadth and evidence confidence separately. Evaluator UX ratings are **heuristic**, not measured human usability or proof of owner suitability; reserve the latter for observation of the owner's actual tasks and the owner's preference judgment.

| Score | Functionality | Heuristic UX |
|---|---|---|
| 0 | Demonstrably cannot achieve the predefined goal | No usable path in the tested state |
| 1 | Major failure or unsafe/misleading outcome | Major confusion or a major workaround required |
| 2 | Only part of the required outcome achieved | Achievable, but important friction or unclear state |
| 3 | Goal achieved with a minor correctness/completeness limitation | Clear and reasonably efficient, with minor friction |
| 4 | All predefined completion criteria met correctly | Clear, efficient and predictable in the observed path |

Use `NT` for not tested, `BLOCKED` for an environmental constraint, and `N/A` only with a justified mismatch to the product's intended workflow, not to hide a demonstrated missing core path. Record narrow scope (for example, setup controls only) without assigning an outcome score. A happy-path variant can earn 4 without a recovery test; recovery has its own score and coverage entry.

Publish executed coverage as a numerator/denominator of the declared variant set beside any partial score, plus the matched subset and remaining blockers. No overall ranking until the declared comparison set has equivalent coverage across products. If aggregation becomes justified, use only the same matched variants, first average within each scene and then weight A and B 50/50; do not let extra easy checks dominate. A critical wrong-target approval, data-loss, or false-success finding remains a release blocker regardless of an average.

Keep a separate competitive coverage matrix: available, partial, absent, deliberately deferred, unknown. MAWS's P1 omissions count as competitive gaps, but not as P0 contract violations. Reference-only workflows outside MAWS's charter are opportunities, not automatic requirements.

### Replacement-readiness gates

These are MAWS-specific prerequisites, reported separately from matched competitive scores as `PASS`, `FAIL`, `NT` or `BLOCKED`, with evidence and scope. They are not satisfied by controls being present, source inspection, or a high partial average.

| Gate | Required evidence before claiming daily-driver readiness |
|---|---|
| CLI interoperability and foreign-live safety | Resume settled synthetic histories terminal → MAWS and MAWS → terminal without history loss. While a scratch CLI/background process owns a live session, verify truthful holder/read-only state, disabled composer/approvals and no second writer; resume only after the original writer stops. |
| Actual configuration and extensions | Inventory the owner's actual user/project settings, trust/overrides, hooks, MCP servers and plugins used daily. On authorized paths with synthetic task data, verify effective configuration and benign hook effects, MCP tool round trips and plugin/skill commands. Default settings or generic fixtures do not establish compatibility with that inventory; retain untested items explicitly and do not expose secrets or mutate global configuration. |
| Essential composer and command workflows | Record the owner-essential/charter-required subset, then exercise draft editing and send, file/paste and `@` context, slash/skill commands, queue/steer/stop/resume, and command modes/history where required. Verify intended engine/file effects, retained input and correct targeting, not merely menu discovery. |
| Real engine round trips | Through a permitted authenticated path on the pinned unmodified engine, verify first turn, follow-up, benign tool effects, a control reply and interruption/resume against transcript/process and scratch artifact truth. Replay/stub results cannot close this gate. |

A partial report can identify a promising replacement candidate, but **cannot establish daily-driver readiness** while required gates remain failed, untested or blocked. Even passing technical gates does not settle owner suitability: that requires owner task observation and preference judgment in both scenes.

### Finding record

For each material finding: ID; concise user-impact statement; product/version; scene/task and scenario/variant if applicable; matched or unmatched scope; preconditions and reproduction; predefined expected vs actual outcome; evidence class and locator; severity; reproducibility; relevant charter scope; reference behavior; recommendation; confidence and limits.

Prioritize by user impact: critical safety/data integrity, blocked core task, repeated daily friction, then cosmetic refinement. Avoid presenting hypothetical code risks as observed UX failures.

## Initial environment inventory

- MAWS source baseline `a2dca3a0`; package version `0.0.0`; pinned Electron `44.4.5`; Node `v22.23.2`; pnpm `11.23.0`.
- Claude Desktop installed `2.16120.0`; Code surface directly accessible; current locale Korean. Existing histories are not synthetic benchmark tasks.
- T3 Code (Alpha) installed `0.0.40`; directly accessible; offers update `0.0.44`, not applied. Current theme dark and locale English.
- `/Applications/ChatGPT.app` identifies as `com.openai.codex`, version `26.924.22138` (build `11645`). Other same-bundle app copies exist. Computer-use access to this bundle is refused by the tool. Do not relabel this installed app as a verified Codex desktop build or try another same-bundle copy to circumvent the refusal. Codex live tests are blocked; public/source evidence remains usable.
- An existing MAWS app is running; provenance and data isolation must be established before treating it as the worktree build or mutating its sessions.

## Deliverables and stopping condition

1. Versioned method and task matrix (this document).
2. Local evidence ledger with explicit execution scope and blockers.
3. Comparative findings and coverage matrix, with narrowly justified ratings rather than invented overall scores.
4. Prioritized next assessment/fix recommendations, leaving product changes for a separate decision.

Continue through unaffected assessment tasks when one reference or live provider is blocked. Stop at a meaningful evidence-backed report when further coverage requires the owner's access, judgment, or a separate test sitting; name exactly what would resolve each gap.
