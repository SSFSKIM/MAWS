# Comparative app assessment — initial native evidence ledger

Parent: `docs/charter.md`, cross-cutting C1–C12; parent pin `35d8c3d1fd65fad2273134c47f72c576e1468f73`. MAWS baseline `a2dca3a0`. Date: 2026-10-01. Method: `docs/doperpowers/plans/2026-10-01-comparative-app-assessment.md`.

This is an initial exploration, not completion of the planned matched benchmark or P0 acceptance. No product source was changed. Screenshots and native accessibility observations were obtained with `cua_repl`; source traces were read-only. Times in screenshots include time spent inspecting other apps, not app latency measurements.

## Environment and isolation

| Product | Exact observed baseline | Execution scope |
|---|---|---|
| MAWS | `a2dca3a0`, package `0.0.0`, Electron `44.4.5`; Settings verified custody version `2.1.283` | Production `pnpm build` output launched through this worktree's Electron, not a packaged/signed acceptance build. English app UI, Korean native menus, light theme. Screenshot 2560×1640 pixels. |
| Claude Desktop Code | `/Applications/Claude.app`, `2.16120.0` | Existing authenticated profile, Code surface, Korean locale/light theme. New synthetic **local, no-folder** session. Selected Opus 5.5 / Extra / Auto were existing defaults, not normalized to MAWS. Screenshot 2846×1558 pixels. |
| T3 Code (Alpha) | `/Applications/T3 Code (Alpha).app`, `0.0.40`; update `0.0.44` offered, not installed | Existing authenticated profile, English/dark. Added only the synthetic folder as a project. Fable 5.1 / Medium; changed this test session from Full access to Supervised before sending. Screenshot 2618×1560 pixels. Binary equivalence to upstream tag is unverified. |
| Codex-family app | `/Applications/ChatGPT.app`, bundle `com.openai.codex`, `26.924.22138`, build `11645` | Computer-use tool refused control of this bundle for safety reasons. No alternative same-bundle copy was attempted after that refusal. Public documentation/source only; no live behavioral scores. |

MAWS scratch root: `/private/tmp/maws-assessment.5TTR4h`. Separate `userData`, engine `config`, and zsh `shell` paths. Scratch engine settings preserved all 10 existing deny rules and selected manual/default permissions; other user configuration was not copied. Therefore this does **not** establish compatibility with the owner's actual hooks, plugins, MCP servers, or instructions. `MAWS_CLAUDE_USAGE_DIR` pointed to a nonexistent scratch path: missing usage windows were intentional, not a product failure. `HOME` was not replaced. This was profile isolation, not an OS sandbox.

The local relay returned HTTP 200 from `http://127.0.0.1:8641/api/hello`; no relay restart or credential change was made. Product custody copied the pinned binary into the scratch profile. `MAWS_E2E`, `MAWS_HARNESS`, `MAWS_ENGINE_REPLAY`, and `MAWS_SESSION_SOURCE` were absent for native work. The owner's existing MAWS bundle and sessions were not operated.

## Fresh automated baseline

Command: `pnpm typecheck && pnpm test && pnpm build`, exit 0.

```text
Test Files  376 passed | 1 skipped (377)
Tests       4653 passed | 1 skipped (4654)
Type Errors no errors
Duration    100.46s
Production build: main, preload, renderer completed; command exit 0
```

`pnpm install --frozen-lockfile` also exited 0. Node `v22.23.2`; pnpm `11.23.0`.

These were the default Vitest selection, typecheck and production build. No claim of a fresh lint, packaged, complete E2E, live-probe, or native-notification gate. Full command output remains in this assessment session's tool record (`bjz9zxqv2`).

## Native execution record

### N1 — MAWS add project, prepare session and run a real turn

Starting state: empty isolated profile, one scratch directory containing only a 181-byte README, no repository initialized. Add project → native folder picker → scratch project → New session in project.

Observed:
- Project was added and unstarted session opened.
- Accessibility focus remained on the sidebar's New session button, not the Message editor.
- Location, add-directory, permission and model controls were present. Permission choices had explanatory text but raw names (`default`, `acceptEdits`, `bypassPermissions`).
- Selected Sonnet 5 / medium in the model widget and applied. Widget remained open; closed it explicitly. Its footer exposed `list_models`, `set_model`, and `apply_flag_settings` implementation vocabulary.
- First Send opened a docked trust card explaining settings/hooks/MCP/plugins and draft preservation. Selected **Start without trusting**; did not grant workspace trust.

Prompt, exactly:

> This is a synthetic app assessment. Do not use tools or access files. Reply with exactly: ASSESSMENT_READY

Observed completion: `ASSESSMENT_READY`; session idle; title generated. The model chip changed from `Sonnet 5 · medium` to `claude-sonnet-5-5[1m] · medium`. Header/composer branch changed from absent/— to `HEAD`, while Session overview said **Not a git repository**. Native log corroborated `git.watch failed NotARepositoryError: not a git repository`.

Evidence: `shots/maws-new-session.jpg`, `shots/maws-nonrepository-metadata.jpg`; native AX observations; isolated engine transcript corroboration below. This proves this first-turn path, not worktree setup, trusted-project initialization or general launch reliability.

### N2 — Same first-turn prompt in Claude Desktop Code and T3

Sent N1's exact no-tools prompt in each new synthetic session. Both displayed `ASSESSMENT_READY` and returned to idle/send state.

Claude: no-folder local Code session, composer retained focus after send; friendly model label remained Opus 5.5. T3: synthetic non-repository folder; displayed **Initialize Git**, not a fabricated branch; composer retained focus after send. T3 also displayed an internal transcript row: `Claude system message 'ui_invalidate' — event: ui.render`.

Evidence: `shots/claude-first-turn-cropped.jpg`, `shots/t3-first-turn-cropped.jpg`; native AX reported completed state. Different model, mode, window size, profile and folder preconditions prevent treating this as a matched start-up performance/usability benchmark. No model-latency comparison is made. These are observed output paths, not an audit of reference engines' internal tool logs.

### N3 — Structured question round trip in all three apps

Sent the same follow-up in each app:

> For the next synthetic test, use AskUserQuestion once to ask which label to use, with options Alpha and Beta. Do not use other tools or access files. After I answer, reply with exactly LABEL_SELECTED followed by my chosen label.

All three produced a native question form with Alpha and Beta. Selected Beta in each. All three returned **LABEL_SELECTED Beta**.

MAWS:
1. Question replaced composer; focused question container; sidebar and tab showed Question, Needs you = 1.
2. Opened Overview. The request was rendered and answerable inline, including project/session identity.
3. Selected Beta. Pressing Return while the radio had focus did not submit in this observation. Clicked Submit.
4. Needs you became 0; card became Working, then Idle/unread with `LABEL_SELECTED Beta`. No second app session was pending; this is not a wrong-target/concurrent-approval test.

Claude and T3: clicking Beta submitted immediately in this single-question/single-select case. Both retired their form and displayed the returned answer. This is a behavior difference, not proof that immediate submission is universally preferable; multi-select and multi-question behavior were not tested.

T3 showed raw AskUserQuestion JSON in its in-progress tool-summary row. Its sidebar still had the previously selected unrelated project filter; the test thread was visible in the main pane, not in that filtered sidebar. Do not mistake that controlled filter state for missing session storage.

Evidence: `shots/maws-overview-question.jpg`, `shots/t3-question-cropped.jpg`; native AX completion observations for all three. MAWS isolated transcript independently contained only tool name `AskUserQuestion` and assistant text `ASSESSMENT_READY`, `LABEL_SELECTED Beta` (31 JSONL records, one main transcript at corroboration time).

### N4 — MAWS native terminal and file viewer

Terminal: Add a tool → Terminal. Focus moved to Terminal input. Executed only:

```sh
pwd; printf "history=%s\n" "$HISTFILE"; printf "ASSESSMENT_TERMINAL_OK\n"
```

Screenshot visibly showed the scratch project directory, `history=/private/tmp/maws-assessment.5TTR4h/shell/.zsh_history`, and `ASSESSMENT_TERMINAL_OK`. No code edits, external links, package installation or provider calls were run in this terminal.

Files: Add a tool → Files → expand project → README.md. Rendered viewer showed the exact authored fixture prose. Source toggle showed markdown source. Cmd+backslash moved the file to a second main pane while the session remained left. File content and location were correct. Editing/read-only enforcement, line jump and wrapping were not exercised; the planned P0 read-only boundary is source/spec-backed, not an editing test here.

Evidence: `shots/maws-file-split.jpg`; terminal screenshot remains in the session tool record (not checked in because it contains the shell's user/host prompt). No live equivalent reference terminal/file test was run.

### N5 — MAWS Settings clipping in split

From normal layout with default sidebar and auxiliary panel visible, Cmd+comma opened Settings. Cmd+backslash moved Settings into the right main pane. Window screenshot 2560×1640; sidebar AX size 300 and auxiliary-panel size 380 (logical units); main split AX size 300.

Observed: Settings navigation and row labels remained visible, but Engine values and controls were clipped out of the visible pane. The narrow layout did not reflow into a usable settings form. Accessibility-tree activation of the invisible Change… control still opened its native picker; canceled without selecting a binary. Therefore **visually clipped**, not proven absent from accessibility or impossible to activate by every method. Cmd+backslash restored a readable single main pane. No setting changed.

Evidence: `shots/maws-settings-split.jpg`. This freshly reproduces a previously recorded acceptance gap rather than discovering an entirely new one. No matching reference split-settings case was exercised.

### N6 — MAWS renderer reload preserves draft and readable state

Closed the file split. Clicked Message and typed `UNSENT_ASSESSMENT_DRAFT` without sending. Cmd+R reloaded the renderer. Observed: the exact draft returned; both prior user turns and returned answers remained visible; Terminal and Files tool tabs returned. Selected Terminal: prior cwd/history/marker output and prompt remained visible.

This establishes draft/history/tab/output restoration for a renderer reload. It does not establish crash recovery, app restart, same PTY PID, a running process surviving, durable queued messages, or correct pending-request recovery. Those require separate variants. A batched close-split→focus-composer shortcut attempt did not move focus; because the actions were sent without an intervening settled observation, it is not logged as a product shortcut defect.

Evidence: native AX after Cmd+R; terminal/draft screenshot in session tool record. Draft was not sent to a model.

## Evidence handling and limits

- `shots/` contains native screenshots, recompressed at JPEG quality 90. Claude/T3 screenshots were cropped to exclude unrelated private sidebar history/account information: Claude crop x=485; T3 crop x=455 in original pixels. No remaining content was rearranged. Different sizes/themes remain explicit; these are not normalized visual-performance comparisons.
- CUA's first T3 launch timed out, then succeeded. A MAWS native-picker paste timed out and did not enter the intended path; accessible setValue succeeded. A T3 path-entry keyboard attempt landed in the command palette; retry using accessible setValue succeeded. These are automation/environment observations, not assigned product defects without independent reproduction.
- Compound shell invocations were refused by the worktree guard; the local launch helper constructed the environment and launched only this checkout's Electron. No denied Codex access was retried through another tool or app copy.
- Native OS notifications, Korean IME composition, modifier-click links, sleep/wake, concurrent approval identity, live queue/steer/stop, trusted configuration parity, code changes/diff truth and CLI interoperability are not certified by this pass.
- Planned matched scenario coverage S1/S2/S3-first-follow-up/S4/S3-interrupted: **0/5 completed per product**. N1–N6 are explicitly narrower exploratory checks. The overall product rating and replacement verdict remain unassigned.

## End-of-pass state

Quit the isolated Electron instance with Cmd+Q; its launcher exited 0. Native app inventory no longer listed that Electron instance and still listed the owner's existing `dev.maws.app` as running. Scratch data was retained for follow-up, including the unsent draft. Reference apps were left at their idle synthetic sessions; no histories were deleted and no app updates were applied. No assessment content was pushed, published, or sent as an upstream report.
