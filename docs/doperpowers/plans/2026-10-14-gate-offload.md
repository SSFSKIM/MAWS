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
| 1, hardware-independent | `typecheck`, `lint`, `test` (every vitest project except `live`), `build` then the bundle guard, `test:probes`, and every `e2e:<group>` that runs green under xvfb on Linux (expected: `default`, the bare `pnpm e2e` after `pnpm build` as `verify` orders them (Decision Log 5); artifacts, library, side, tools, to-human, deliverables, panel, supervisor, browser, browser-comment, browser-import, settings, transcript, terminal, code, agents, widgets, c7, scm, c12, available; the children's document, document-app, presentations, design-systems as they land) | GitHub Actions, `ubuntu-24.04`, through `scripts/ci-gate.sh` |
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

Each guard is `skipIf(process.platform !== 'darwin')` (for the one case of an `it.for` table, the context's `skip` on the same condition) with a `// macOS:` comment naming the fact. A guarded case runs nowhere on the runner, so it stays a Mac gate: `pnpm exec vitest run <the files below>` under the load rule, as M1 ran them (all pass on the Mac, none skipped there).

| File and case | The macOS fact it asserts |
|---|---|
| `src/main/browser/cua/admission.test.ts`: `a peer judged at accept… > the committed addon loaded reports loaded…` | The committed peer identity addon (`native/peer-auth/prebuilds/darwin-arm64/peer-auth.node`), which the loader serves only on Apple silicon macOS. (`the socket file > is 0600 once it listens` runs everywhere: it starts its stand with `peer: null`, since the socket's mode does not depend on the peer.) |
| `src/main/browser/cua/index.test.ts`: every describe (19 cases) | The same addon: every stand admits its fake host through it |
| `src/main/browser/cua/retained.test.ts`: every describe (18 cases) | The same addon |
| `src/main/browser/cua/peer.test.ts`: `the addon (the committed prebuild, real processes)` (5 cases); `the loader > loads the committed prebuild on Apple silicon macOS` (the one assertion that loads it, split from `reports unavailable for a missing file, and off Apple silicon macOS without trying`, which runs everywhere) | The same addon, loaded for real (a Mach-O arm64 binary) |
| `src/main/browser/index.test.ts`: `startBrowser: cua's primitive server (E13) > names each known session's engine…` | The server's peer module is the same addon |
| `src/main/files/service.test.ts`: `swap and restore… > refuses an ancestor swapped outside before the open…`; `negative control > serves the outside file through the pre-review open-then-confirm shape…`; `has a kernel that honours O_NOFOLLOW_ANY…`; `files service write > the boundary… > refuses an ancestor swapped to an outside link at before-open (ELOOP)…` | The kernel honours `O_NOFOLLOW_ANY` (0x20000000, macOS 11 and later); Linux ignores the bit. The kernel check still fails loudly on a macOS that dropped it, the case it exists for |
| `src/main/files/allowlist.test.ts`: `canonicalises case on a case-insensitive volume…` | The temporary directory is on a case-insensitive APFS volume |
| `src/main/files/watch.test.ts`: `ages a file on this volume…`; `reports created, changed and removed`; `coalesces a burst of events per filename into one batch` | APFS moves a file's birth time back to an earlier mtime set through `utimes` (the suite's `age`); ext4 keeps the real birth time, so no file reads `changed` |
| `src/main/files/watch.test.ts`: `unwatch drops the hold… when its realpath moved between two watches` | A case-insensitive APFS volume, where a case-only rename leaves the old path naming the directory |
| `src/main/index/sessions.test.ts`: `upserts 4,000 synthetic summaries… in under 500 ms of CPU time` | Not a macOS fact but a measured bound (Decision Log 9): a CPU-time budget measured on the Apple silicon Mac (the runner spent 917 ms) |
| `src/engine-host/fs/replay/runner.test.ts`: `'instant' over 3,300 rows completes in under 200 ms in batches of at most 500` | The same: a CPU-time budget measured on the Mac (its batching is also pinned by the unguarded `'instant' yields after every batch…`) |
| `src/main/sessions/stub-store.test.ts`: `answers session.list for a thousand sessions from memory in under a millisecond` | The same: a median latency budget measured on the Mac |
| `src/pty-host/table.test.ts`: `pty host foreground detection > reports busy false at a /bin/sh prompt…` | node-pty names the foreground process by its kernel name on macOS (`sh`, or the bash it re-executes); on Linux it reads argv[0] from `/proc`, `/bin/sh`, which no shell-name rule matches |
| `src/pty-host/table.test.ts`: `pty host initial command runs under zsh and bash > /bin/zsh starts as a login shell…` (the zsh case; the bash case runs) | zsh starts under macOS's system startup files (`/etc/zprofile`, and `/etc/zshrc`, which puts `HISTFILE` under `ZDOTDIR`); Ubuntu's `/etc/zsh` files differ |
| `test/support/shell-home.test.ts`: `gives a zsh login shell its own profile and history file…` | The same: macOS's `/etc/zshrc` names the history file `${ZDOTDIR}/.zsh_history`; Ubuntu's zsh keeps the inherited `.sh_history` |

## 7. Decision Log

1. **2026-10-14 (architect).** Offload only the hardware-independent class; the timing class stays local under Decision Log 54 and 63 until P3-F's dedicated Mac (the owner's decision).
2. **2026-10-14 (architect).** GitHub Actions before a Cloud Run job: the repository, `gh` and the executors' push already exist, so the only new piece is the workflow and a script; a Cloud Run job needs an image with Electron, LibreOffice and the store, a trigger and log retrieval, and is the move when the runner queue becomes the bottleneck.
3. **2026-10-14 (architect).** The package scripts run verbatim on the runner so a gate's meaning is one definition on both machines; the runner's extras (xvfb, fonts, the sandbox fix, LibreOffice) live in the workflow, not in the scripts.
4. **2026-10-14 (executor).** The actions run at their current majors (`actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache@v6`, `actions/upload-artifact@v7`, `pnpm/action-setup@v6`; §3.2 named `setup-node@v4`, whose Node 20 runtime is past its end). The checkout is each job's first step and the composite action's steps follow it, since a local action cannot be read before the tree is checked out.
5. **2026-10-14 (architect, at the executor's question).** The bare `pnpm e2e` set (smoke, shell, sessions, palette, statusline, resume-picker, engine-replay, fixture-safety, c3-stall, sigusr1, the shot specs) is class 1 as the matrix group `default`: `pnpm build`, then `pnpm e2e` under xvfb, as `verify` orders them. Nothing else runs those specs.
6. **2026-10-14 (executor).** A `plan` job reads the gate set (the `gates` input, the `Gates:` trailer of the pushed commit, or the class-1 default) through `.github/scripts/gate-plan.mjs` and hands the other jobs their switches and the e2e matrix; it refuses a gate with no package script. It costs one job-minute per run, the price of building the matrix from a trailer. The class-1 e2e list and the LibreOffice list are two lines of the workflow's `env`; a listed group whose script does not exist yet is skipped, so the children's groups join the default set at the commit that adds their script, and a child whose group renders through LibreOffice adds its name to `LIBREOFFICE_E2E`.
7. **2026-10-14 (architect's direction, the owner deciding on a self-hosted macOS runner).** The runner is named in one place, a YAML anchor on the `plan` job's `runs-on` (`vars.GATE_RUNNER`, default `ubuntu-24.04`) that every job repeats; every Linux-only step (apt packages, xvfb, the apparmor sysctl) runs under `runner.os == 'Linux'`, and the Electron cache path follows the runner's OS.
8. **2026-10-14 (executor; amended the same day at the architect's ruling).** The unit job installs `zsh` (the PTY suites start `/bin/zsh`, macOS's login shell; with it the zsh job-control cases of `pause-take-over.pty.test.ts` run green on Linux instead of being guarded) and passes `--maxWorkers` at the runner's core count (2 on the private repository's standard runner). The runner keeps its own zone (UTC): a first cut set `TZ` to the Mac's zone, which the architect ruled out because it masks a zone-dependent test; the test was fixed instead (Surprises).
11. **2026-10-14 (architect's authorization).** `src/renderer/src/sessions/resource.test.tsx` joins `TIMING_RENDERER_TESTS` (30 s) beside `App.test.tsx`: a whole-tree mount switched across 20 sessions, which overran the renderer project's 5 s on the 2-core runner in 2 of 3 runs. The config's own rule puts such a suite in a `-timing` project, and the file was already on the architect's list of load-sensitive files from A's and L's gates, so this applies the rule rather than re-timing an assertion.
12. **2026-10-14 (executor).** The e2e jobs install `fonts-inter` and `fonts-jetbrains-mono` beside the CJK fonts: the UI tokens name Inter after SF Pro and JetBrains Mono after SF Mono, so on Linux the renderer sets text in the stack's own fallbacks, whose metrics are close to the Mac's, instead of DejaVu (M2's first `side` run failed two layout assertions under DejaVu).
9. **2026-10-14 (executor, from M1's review).** §2 keeps measured bounds off Actions, and the unit suite carries some inside ordinary cases. A case whose point is a performance budget measured on the Mac (a CPU-time or latency budget: the session upserts, the replay runner's `instant`, the stub store's list) takes the platform guard and is listed in §6 as a measured bound; it runs with the other guarded files on the Mac. A wall-clock bound with a wide margin that catches a hang or a lost linearity (the CSS path's near-miss, the to-human parser's pairing, the fuzzy matcher's "a stall is seconds", the sidebar at scale, the index's "never the 2 s busy timeout") is a functional check and stays on the runner. A guard covers only the part that needs the Mac: where a case mixed portable assertions with one macOS assertion, the macOS one moved to a case of its own (`peer.test.ts`), and where only the harness's default reached for the addon, the case starts without it (`admission.test.ts`'s socket mode).
10. **2026-10-14 (executor, from M1's review).** On a Linux runner the plan refuses an explicitly requested e2e group outside `CLASS1_E2E` (class 2 runs on the Mac), so a child asking for `e2e:packaged` gets a refusal instead of a run that cannot pass; on a macOS runner every group with a script is admitted. `CLASS1_E2E` is therefore the class-1 list itself: M2 removes a group from it when the group moves to class 2.

## 8. Surprises & Discoveries

- node-pty 1.1.0 ships no Linux prebuild (`prebuilds/` holds darwin-arm64, darwin-x64 and win32 only), contrary to §3.3's note: on the runner its install script falls back to `node-gyp rebuild` (python3 and build-essential are on the `ubuntu-24.04` image). The postinstall design holds unchanged.
- The private repository's standard Linux runner has 2 cores. On it the unit job takes about 17 minutes (the suite alone 600 to 920 s), `static` about 5 and `probes` about 1; the vitest summary reads 885 files and 12,635 tests.
- `src/renderer/src/tools/agents/model/scheduled.test.ts` (`createdCrons and sessionCrons over e7-cron > lists the session-only jobs the engine resurrected on resume…`) depended on the machine's zone despite its header: it passed in America/Los_Angeles and failed in UTC and in Asia/Seoul (measured on the Mac with `TZ=`). On the runner, in UTC:

  ```
  AssertionError: expected [ '8d1a2582' ] to deeply equal [ '8d1a2582', '1040f3a5' ]
   ❯ src/renderer/src/tools/agents/model/scheduled.test.ts:46:79
  ```

  The recording (`e7-cron.jsonl`, its `e7_cron_setup` frame names `timezone: America/Los_Angeles`) created the one-shot `15 4 6 10 *` at 04:12 local, three minutes before its fire; read in UTC or Seoul its creation falls after that day's 04:15, so its fire moves a year on, past the nightly job's seven-day life. Fixed in the test at the architect's direction (671d6d84): the describe over the recording sets `process.env.TZ` to the recording's zone and restores it after, so the cases read the recording as it was made in any machine zone; passes on the Mac under UTC, Asia/Seoul and America/Los_Angeles.
- `test/support/git-env.test.ts` raced the runner's git once in three runs:

  ```
  Error: ENOENT: no such file or directory, open '/tmp/maws-git-oracle-qz307V/foreign/.git/objects/maintenance.lock'
   ❯ test/support/git-env.test.ts:29:23
  ```

  Its snapshot of the foreign repository listed the lock that the detached auto-maintenance `git commit` starts (git 2.47 and later) holds, and the maintenance dropped it before the read. The Mac's `/usr/bin/git` is 2.50.1, past that version, so the race was the test's own on either machine. Fixed at the architect's direction (27fc61ac): the fixture's commit runs with `-c maintenance.auto=false`, the comment naming git 2.47's detached auto-maintenance.
- `src/renderer/src/sessions/resource.test.tsx` (`a focused switch across 20 exited sessions starts nothing`) overran the renderer project's 5 s in 2 of 3 runs on the 2-core runner (`Error: Test timed out in 5000ms.`): a whole-tree mount in a 5 s project. Moved to the timing project (Decision Log 11, 009ef888).
- The first e2e job (`side`, run 38661816432) proved the runner's Electron: under xvfb, with the apparmor restriction lifted and the app's sandbox on, 10 of its 12 cases passed. The failed job's HTML report and `test-results/` came down as the `e2e-side` artifact.

## 9. Outcomes & Retrospective
