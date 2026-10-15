# Gate offload: hardware-independent gates on GitHub Actions

Living spec (doperpowers:execspec), authored 2026-10-14 by the architect at the owner's decision after P3-B's M9: "start the GitHub Actions offload now as a small spec; the dedicated quiet Mac for timing gates at P3-F". Not a P3 child; tooling for every child's gates. Cites the P3 composite spec `docs/doperpowers/plans/2026-10-12-p3-co-work.md` Decision Log 54, 63 (the load rule for measured bounds, unchanged here) and 64 (this split). Branch `gate-offload`; the architect lands it through a master gate.

## 1. Purpose

One Mac carries three child executors, their workers, their reviewers and the owner's running MAWS, so every gate run raises the machine's load and every measured bound waits for the load to fall (two slots machine-wide, `waitload20.sh`, the marginal band of Decision Log 54 and 63; one child waited seven hours for a quiet minute). The gates split into two classes. Hardware-independent gates (typecheck, lint, the unit suite, the build and bundle guard, the protocol probes, most e2e groups) can run anywhere; they are most of the CPU minutes but none of the hardware dependence. Hardware-bound gates (measured bounds on Apple Silicon, macOS-only behaviour, the paid live runs) stay on the Mac. This spec moves the first class to GitHub Actions on Linux, behind one local script that an executor calls the way it calls `with-slot.sh` today, so the Mac's load comes from measured runs and the owner's app alone. The dedicated quiet Mac for the second class is P3-F's.

## 2. Constraints

- The repository is private (`SSFSKIM/MAWS`, Actions enabled, no workflow yet). Linux minutes bill at the plan's rate beyond the free allowance; the script runs only the gates asked for, so a child reruns the groups it touched, not the matrix.
- Children's branches are not pushed; each run pushes one sha to a `ci/<label>-<short>` ref and deletes it after (`--keep` to leave it).
- Timing and measured bounds never run on Actions: a runner's CPU and GPU-less renderer make a frame time or a loop latency noise, not a measurement. Decision Log 54 and 63 govern those runs locally, unchanged.
- No test is deleted, weakened or re-timed to pass on Linux. A test asserting a macOS fact (APFS case folding, `ps` or `zsh` job control, a Keychain, the packaged app) is guarded with `skipIf(process.platform !== 'darwin')` and one comment naming the fact; the guarded list is in this document and reported at the hand-back. A Linux failure that is a real defect is reported, not guarded.
- The package scripts stay the one source of truth for what a gate is: the workflow runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:probes`, `pnpm build` and `pnpm e2e:<group>` verbatim (under `xvfb-run -a` for e2e), so a gate means the same thing on the Mac and on the runner.
- Rules binding every milestone: absolute paths with `git -C` and `pnpm -C`; `pnpm_config_verify_deps_before_run=false`; before any local `pnpm test`, e2e or build `/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh <cmd>` (local runs here are typecheck, lint and targeted vitest files only; the suites run on Actions); never touch the owner's running MAWS, `dist`, the user-data directory or `~/.claude`; never stage `node_modules`, `spikes/gws-onboarding/`, `.playwright-cli/`; no attribution in commit messages; never amend or reset; commit as you go; the execution document is this file (the executor appends to Decision Log, Surprises and Outcomes; the architect owns the rest).

## 3. Design

### 3.1 The gate classes

| Class | Gates | Where |
|---|---|---|
| 1, hardware-independent | `typecheck`, `lint`, `test` (every vitest project except `live`), `build` then the bundle guard, `test:probes`, and every `e2e:<group>` that runs green under xvfb on Linux (expected: artifacts, library, side, tools, to-human, deliverables, panel, supervisor, browser, browser-comment, browser-import, settings, transcript, terminal, code, agents, widgets, c7, scm, c12, available; the children's document, document-app, presentations, design-systems as they land) | GitHub Actions, `ubuntu-24.04`, through `scripts/ci-gate.sh` |
| 2, hardware-bound | every measured bound (B's `document-scale`, A's perf case, C's M10 scale gate, any `MAWS_*_PERF` seam); macOS-only groups (`browser-chrome`, `browser-cua`, `voice`, `e2e:packaged`, `supervisor:packaged`, `verify:fuses`, `build:app`); the paid live specs (`MAWS_LIVE`, `MAWS_C7_LIVE`, `*-live.spec.ts`) | The Mac, under `waitload20.sh` and `with-slot.sh`, Decision Log 54 and 63; the dedicated quiet Mac at P3-F |

M2 settles the class-1 e2e list empirically: a group that fails on Linux for a platform reason joins class 2 with the reason written here; a group that fails for a defect is reported.

### 3.2 The workflow `.github/workflows/gate.yml`

Triggers: `push` on `ci/**` (the script's refs; the workflow file travels with the pushed tree, so a branch carrying the workflow tests itself before it lands) and `workflow_dispatch` with the same `gates` input for a manual run. Input `gates`: a comma list over `static`, `unit`, `probes`, `e2e:<group>`, …, read from the ref's last commit message trailer `Gates: …` for the push trigger (the script writes it onto an empty commit when the caller narrows the set) or defaulting to the whole class-1 set.

Jobs, each on `ubuntu-24.04`, `timeout-minutes: 30`, with `concurrency: {group: gate-<ref>, cancel-in-progress: true}`:

- `static`: `pnpm typecheck`, `pnpm lint`.
- `unit`: `pnpm build` (the bundle guard reads the engine-host chunk), then `pnpm test` with vitest's workers at the runner's cores; the timing projects keep their 30 s.
- `probes`: `pnpm test:probes`.
- `e2e`: a matrix over the requested groups, `fail-fast: false`; each job `xvfb-run -a --server-args="-screen 0 1920x1080x24" pnpm e2e:<group>` with `MAWS_E2E_QUIET=1`; Playwright's HTML report and `test-results/` uploaded as an artifact on failure (`if: failure()`), retention 7 days.

Shared setup (a composite action `.github/actions/setup` so the jobs do not repeat it): `actions/checkout` at the pushed sha; `pnpm/action-setup` reading `packageManager`; `actions/setup-node@v4` with Node 22 and `cache: pnpm`; a cache on `~/.cache/electron` keyed by the Electron version; `pnpm install --frozen-lockfile`; for e2e jobs `apt-get install xvfb fonts-noto-cjk` (Korean text in the renderer) and, for the groups that render documents through LibreOffice, `libreoffice-writer libreoffice-impress` (B's DOCX-to-PDF case, C's render-and-compare); Electron's sandbox on the runner: the apparmor restriction on unprivileged user namespaces lifted with `sysctl kernel.apparmor_restrict_unprivileged_userns=0` (the documented runner fix), never `--no-sandbox` in the app. Each job writes its counts to `$GITHUB_STEP_SUMMARY`.

### 3.3 The Linux adaptations

- `postinstall` is `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper && install-electron`, which fails where the darwin prebuild is absent: it becomes `node scripts/postinstall.mjs`, chmod of the darwin spawn helper only when it exists (node-pty 1.1.0 ships Linux prebuilds), then `install-electron`; behaviour on the Mac unchanged.
- Tests asserting macOS facts gain the guard of §2 with the fact named; the list lives in §6 of this document.
- Node 22.13 or later is required for `node:sqlite` unflagged (the Mac runs 22.23); the workflow pins the Node major to 22 and `engines` stays `>=22.12` unless M1 finds the store tests need the bump recorded.

### 3.4 The local script `scripts/ci-gate.sh`

`scripts/ci-gate.sh <worktree-or-sha> [--gates static,unit,probes,e2e:side,…] [--label <name>] [--keep]`. It resolves the sha (a worktree path's `HEAD`, or a sha), pushes `<sha>:refs/heads/ci/<label>-<short>` (force, since a child reruns on a moved tree), finds the run (`gh -R SSFSKIM/MAWS run list --branch ci/<label>-<short> --json databaseId,headSha`, retried until the run for the sha exists), `gh run watch <id> --exit-status`, prints `gh run view <id>` with each job's conclusion, downloads failed jobs' artifacts to `/tmp/maws-review/gates/ci-<short>/`, writes the whole transcript to `/tmp/maws-review/gates/ci-<short>.log`, deletes the `ci/` ref unless `--keep`, and exits with the run's status. It passes `-R` to every `gh` call so it works from any directory. A narrowed `--gates` writes the trailer of §3.2 onto an empty commit on top of the sha before pushing, so the pushed tree is the tested tree plus one message.

### 3.5 What changes for a child

Its brief says: class-1 gates through `scripts/ci-gate.sh <worktree> --gates <what you touched>`; class-2 gates locally under the load rule as today; a Linux-only failure is reported to the architect, never guarded by the child. The P3 spec's Decision Log 64 records the split; the P2 and P3 briefs in flight keep their local gates until their executors are told.

## 4. Plan of Work

### M1 · the workflow's static, unit and probes jobs green on master's sha
- `scripts/postinstall.mjs` and the `postinstall` script; `.github/actions/setup`; `.github/workflows/gate.yml` with `static`, `unit`, `probes`; the Linux test guards of §2 with their facts in §6.
- Acceptance: a push of master's sha to a `ci/` ref runs the three jobs green on `ubuntu-24.04`; the step summaries carry the counts (the unit suite's files and tests, the probes' count); on the Mac `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint` and the guarded files alone (`pnpm exec vitest run <files>`) pass unchanged; the guarded list is in §6 with one macOS fact per entry and no test weakened.

### M2 · the e2e matrix and the class lists
- The `e2e` matrix job with xvfb, fonts, the apparmor fix, LibreOffice where needed, the failure artifact.
- Acceptance: every group named in §3.1's class-1 column either runs green on the runner or is moved to class 2 in §3.1 with its platform reason written; one deliberately failing group on a scratch ref shows the HTML report and `test-results/` as a downloadable artifact; the whole class-1 matrix on master's sha finishes inside 30 minutes wall clock.

### M3 · the local script and the hand-off
- `scripts/ci-gate.sh` per §3.4; its usage at the top of the script; the `Gates:` trailer path; the `--keep` and `--label` flags.
- Acceptance: from a worktree path the script pushes, finds and watches the run, prints each job's conclusion, downloads a failed job's artifact, removes the `ci/` ref, writes the log and exits with the run's status, shown once green and once red (a scratch ref with a failing guard); `gh` is never called without `-R`; a run narrowed with `--gates static` runs only `static`.

## 5. Concrete Steps

Each milestone: a task executor on the branch, then a `doperpowers:reviewer-medium` review of its range, a fix wave, the gates of §2 (local: typecheck, lint, the touched files alone; remote: the workflow's own run); a checkpoint to the architect at each tick by SendMessage with the run URL and the lists changed in this document. At the end: `## Outcomes & Retrospective` here, the final hand-back (branch head, the three run URLs, the class lists, the guarded tests, the measured cost of one full class-1 run in job-minutes), no PR.

## 6. Linux guards (filled by M1 and M2)

| File and case | The macOS fact it asserts |
|---|---|

## 7. Decision Log

1. **2026-10-14 (architect).** Offload only the hardware-independent class; the timing class stays local under Decision Log 54 and 63 until P3-F's dedicated Mac (the owner's decision).
2. **2026-10-14 (architect).** GitHub Actions before a Cloud Run job: the repository, `gh` and the executors' push already exist, so the only new piece is the workflow and a script; a Cloud Run job needs an image with Electron, LibreOffice and the store, a trigger and log retrieval, and is the move when the runner queue becomes the bottleneck.
3. **2026-10-14 (architect).** The package scripts run verbatim on the runner so a gate's meaning is one definition on both machines; the runner's extras (xvfb, fonts, the sandbox fix, LibreOffice) live in the workflow, not in the scripts.
4. **2026-10-14 (architect, at M2's discovery run).** Linux carries class 1a (static, unit, probes, build) and not Electron e2e: of the 22 class-1 e2e groups 4 ran green on `ubuntu-24.04`, 16 failed on platform facts (the app menu inside the window changing the viewport, `app.dock`, Meta accelerators, node-pty's argv[0] naming, `top -s`, no GPU for WebGL or `capturePage`, the peer-auth addon, Keychain, focus under a WM-less X server) and 2 (supervisor, transcript) ran past the job timeout; about 40 per-case guards would leave most e2e cases Mac-only in any case. Ruled: no e2e guards; §3.1 splits class 1 into 1a (Linux) and 1b (e2e, a macOS runner whose home the owner decides); M2 proves the matrix mechanics on the Linux-green groups, records the classification table and wires the macOS runner target (`vars.GATE_RUNNER`, Linux-only steps behind `runner.os`) with a setup section for a self-hosted Mac; M3's script defaults to class 1a until a macOS runner exists. Two real defects found stay fixed (the zone-dependent e2e case; the 20 MB read's budget as a tracker row).

## 8. Surprises & Discoveries

## 9. Outcomes & Retrospective
