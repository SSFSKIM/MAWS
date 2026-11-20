# UX wave · U6b-4c: the execution report

The landing: `docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md` (revision 4), branch `ux-wave/U6b-4c`, executed 2026-11-19 by subagent-driven execution: a fresh executor per milestone, a task review at each milestone's frontier, the fixes resumed on the executor that wrote the code. The document's Progress, Surprises & Discoveries, Decision Log (entries 8 to 16 are this execution's) and Outcomes & Retrospective are the living record; this report is the account for ux-wave.

## Status

All five milestones are built, and each was reviewed clean at its frontier. The branch review (the xhigh panel), the Mac scenes, the macOS-guarded unit cases and the two cross-build runs belong to ux-wave. By ux-wave's ruling no pull request is opened. After the hand-back nothing more is committed to the branch.

## The range

- The document's head at dispatch: `b0779a2c0`.
- The merges of `ux-wave/U6b-4b`, each by ux-wave's instruction:
  - `796895fe8`, merged as `aa95d32c3`;
  - `4d4905175`, merged as `2d96a057a`;
  - `8cd4a7479`, its final head, merged as `5c6432b3d`.
- The landing's own work: `5b6afe386..` the head named in the hand-back, with the merges above inside that range. Against U6b-4b's final head (`git diff 8cd4a7479 HEAD`), this document aside, the landing is 55 files with about 4,500 added and 230 removed lines.

| milestone | commits | review |
|---|---|---|
| M1 the rule | `579496c5e`..`cf9d0644b`; fix `11c7c8438` | clean after one round |
| M2 the record, the command, a Markdown source | `c5fc3ddb1`..`c5dee5dc0`; fixes `5952336c5`, `57c61adc1` | clean after two rounds |
| M3 a subagent's transcript | `de3214dc2`, `e62093eea`; fixes `516940bad`, `2deeecbed`, `d13bdf9da`, `780bb46bb`, `92559e4a7` | clean after two rounds and a test-only path fix |
| M4 the window follows | `86b107c67`..`b31e2248c`; fixes `244852dc7`, `42a0e42d0`, `e36471c6a`, `627334f93`, `a9d06faec` | clean after two rounds |
| M5 the scenes, the record, the acceptance run | `c1a3c664e`, `b568a2011`, `1eb58113a`; fix `adae9a4fb` | clean after one round |

## What exists

- **The daemon.**
  - It answers `files.follow` (`src/services/files/service.ts`, `register.ts`).
  - The link record is kept in `src/services/files/links.ts` (`sessions/file-links.json`, version 1, mode 0600, written whole and atomically).
  - The search over one subagent's file is `namesInAgent` (`src/services/files/named.ts`).
  - The services are wired in `checkouts-root.ts` and `spine-root.ts`.
- **The shared rule.**
  - `src/shared/files/named.ts` holds `resolveRelative`, `fileLinkSteps`, `fileLinkTargets` and `agentRowClaimSteps`.
  - `src/shared/files/markdown.ts` holds `MARKDOWN_RENDER_CAP` and `isMarkdownName`.
- **The wire is at minor 58:** `files.follow`, and `outside.linked` on the read's answer and on every output that shares its schema (`files.readOutside` included).
  - `files.follow` is in `APP_PAGE_ONLY` (`src/main/files/open-file.ts`), not in `OUTSIDE_ACTS`.
  - It has a `notYet` row in `REMOTE_UNAVAILABLE`.
  - It has no row in the endpoint's offers.
- **The window.**
  - `src/renderer/src/tools/code/follow.ts` is new.
  - `OpenFileOptions.from` is held in memory alone.
  - `MarkdownView` gives `from: { file }` for a file's tab, never for an artifact's view.
  - `Transcript.tsx` gives a child's rows an `openFile` that carries the agent's id.
  - `readChunk` waits for a follow; W1 (g)'s owed read again is in `viewer-store.ts`.
  - `locked: 'linked'` reads Q2's sentence (`EDITOR_COPY.readOnly.linked`).
  - The fake disk answers `files.follow`.
- **The scenes.** They are written and typechecked, not run.
  - Two new cases in `e2e/sessions.spec.ts`.
  - A new scene in `e2e/cross-build.spec.ts`, plus a step added to an existing one.
  - The landing's row in the cross-build coverage table.
- **The record.**
  - `docs/charter.md` §19: the entry of 2026-11-18, word for word.
  - `docs/doperpowers/plans/2026-09-28-c8-right-panel.md`: the dated line at K1.
  - `docs/tech-debt-tracker.md`: two rows closed in place, and six rows added (Q5 with `[n](notes.md:7)`, Q7, Q6, Q17, Q18, and the differential's direction for a file). Q12's case is appended to U6c's row on the search's deadline, since no row of the search's bound existed.

## Verification

Every command ran on the build VM (Linux, `dc-uxwave8-94db`) through `vmcheck.sh`, on the pushed head named. The milestones' task reports hold each command's full output (`.doperpowers/sde/…/task-N-report.md`, gitignored).

| check | head | result |
|---|---|---|
| `pnpm typecheck` (every project, desk-web and desk-hub included) | `aa95d32c3` (base, after the first merge) | exit 0 |
| the milestone folders at base | `5b6afe386` | 206 files, 5,094 tests: only `git-reads.test.ts`'s two cases (ticket 756) fail |
| M1's proof (both tsc, eslint, vitest `src/shared/files/ src/services/files/ tools/code/viewer/ tools/code/files/`, the differential, desk-web) | `cf9d0644b`, `11c7c8438` | green; differential 274/274; desk-web 801/801 |
| M1 and M2's sets after U6b-4b's second merge | `2d96a057a` | both tsc and eslint green. Vitest: 4,115 tests with 4 failures, none the landing's: `git-reads` ×2 (ticket 756); the viewer's follow-the-file case (on the brief's list); `daemon-root.test.ts`'s `beforeAll` timed out under a VM load of 22 to 27 and passed alone at load 2.8 (6/6) |
| M2's proof (both tsc, eslint, vitest over services/files, shared/ipc, shared/machine, main/files, daemon-root, cross-build, checkout-rows, lane-b, spine-root; the three snapshots written by their switches; the script tests; the secret scan; desk-web) | `c5dee5dc0`, then `5952336c5`, `57c61adc1` | green but `git-reads` ×2; snapshot diffs additive, no major, no rebase switch |
| M3's proof (node tsc, eslint, vitest `src/services/files/ src/shared/files/`, Node 22 on the two named files, the secret scan) | `e62093eea` … `92559e4a7` | green; 961 passed, 20 skipped (14 darwin-only cases, 6 opt-in measurements) |
| M4's proof (web tsc, eslint, vitest `tools/ transcript/ shell/ panel/ side/ lane-a/ test/lane-b/` with the tokens guard, desk-web) | `b31e2248c`, `42a0e42d0`, `a9d06faec` | green; 3,525/3,525 over `tools/code/` and `transcript/view/` at the last fix; desk-web 801/801 |
| `pnpm typecheck` and `eslint e2e` | `1eb58113a` | exit 0 |
| the gate's script tests | `1eb58113a` | 588/588 |
| the secret scan | `1eb58113a` | 8/8 |
| `pnpm test`, the whole unit suite, once | `1eb58113a` | 47,660 tests: 53 failed in 15 files. Six files are the VM's own failures, each shown failing the same way at the base `5b6afe386` (`git-reads` and `setup`, ticket 756; `portability`, the VM's Node 26; desk-hub's three deploy files, 38 cases). Nine are load time-outs, each passing alone. Two of those nine are not yet on the brief's list: `src/artifacts/document/markdown-runs.test.ts` and `test/react-compiler.test.ts` |
| M5's fix (viewer with the tokens guard, eslint, web and e2e tsc) | `adae9a4fb` | 390/390; exit 0 |

The class 1a run and the desk-web e2e run on the final head are named in the hand-back.

**Not verified here:**
- every scene of §H;
- the macOS-guarded cases of `src/services/files/service.test.ts`, `watch.test.ts`, `allowlist.test.ts` and `own.test.ts`, and the macOS spelling of the temporary root that M3's test fix answers;
- the two cross-build runs.

## Decisions made in execution

Each is in the document's Decision Log with its reasons:
- **8.** The refresh against U6f's names. `files.follow` joins `APP_PAGE_ONLY`, never `OUTSIDE_ACTS`, and `src/main/app.ts` is not edited. The minor is 58.
- **9, 10, 12, 13, 16.** Each milestone's means.
- **10.** The deadline bounds the answer, and the place in the count goes with `located`.
- **11, 15.** U6b-4b's later merges.
- **14.** X5.14 is read at the daemon's admission, accepted by ux-wave with its condition, which a test holds.
- **16.** The older-daemon scene proves its two halves separately: the notice by the click, `unknown_command` by a direct call. A page cannot observe its own click's dispatch, and W1 (b)'s unit case holds the order.

Nothing in the build contradicts the owner's answers: Q2 (read-only inheritance), Q3 (record and log only), an outside file linked from Markdown being editable, and a relative link in an outside Markdown file opening its sibling.

## The branch panel's fix wave (added after the first hand-back)

ux-wave's xhigh panel on `8cd4a7479..6ee5cae21` returned "incorrect" with eleven findings. The findings are kept as `panel-findings.json` in the run's workspace, with a copy in `~/.local/share/maws-ux-wave/u6b4c/`. By ux-wave's ruling, nine were fixed and two recorded. The fixes went to one fresh executor, each finding red first. A task review followed, clean after two rounds. Commits `f7e676676..b91266d11`; Decision Log 17 holds the design statements that moved.

**Fixed:**
- **scalpel-2#1 (P1).** The subagent search counts only rows whose `sessionId` is the asked conversation's and whose `agentId` is the asked agent's.
- **scalpel-2#3.** `files.follow`'s `from.agent` gains an optional `engineSessionId`, taken at the child mount, within minor 58. The daemon answers `not-linked` without it, and its search names nothing for a conversation that is not the current one.
- **scalpel-3#1 (P1).** A Markdown proof holds its turn and its place until its transcript lookup settles.
- **scalpel-3#2.** The subagent search's waiter is aborted when the follow ends.
- **scalpel-3#3.** A stop check runs before each file-system stage, down to the open's confirmation, the Linux ancestor walk (an optional callback in the shared `fs/no-link.ts`), the not-found check and each read.
- **scalpel-3#4.** Both root lookups settle before a place is released. This is one insertion in `allowlist.ts` (U8c-2's file; now in §G).
- **scalpel-4#1.** A link's reopen is held back only by a load that can still land.
- **scalpel-4#3.** A Save that wrote reissues a newer live load.
- **scalpel-4#4.** A read-only continuation whose hash changed reaches W1 (g)'s comparison.

**Recorded as tracker rows of 2026-11-19:**
- sweep#2: one wide folder in the subagent walk.
- scalpel-4#2: an owed read again drops a queued Load more.
- The review's remainder of scalpel-2#3: a drill-in remounted after `/clear` while old rows still show labels them with the new conversation. Recording a link that way needs the same random agent id in two conversations.

**Dismissed at the fix review:** the same-ids/different-inode part of scalpel-2#1. ux-wave ruled either binding sound.

**Verified on the VM:**
- node and web tsc, and eslint;
- vitest over `src/services/files/`, `src/services/fs/`, `src/shared/files/`, `spine-root`, `tools/code/`, `transcript/view/`, `test/lane-b/` and the tokens guard;
- `src/shared/machine` and `src/shared/ipc`: green except the two `git-reads` cases of ticket 756;
- desk-web's typecheck, build and tests (801/801).

The manifest diff is the one property; `routes.json` and `address-paths.json` are unchanged. The gates on the fix wave's head are named in its hand-back.

**Mac scenes the fixes touch:** all four of §H's titled scenes.
- The sessions subagent scene is the most exposed: the window now sends `engineSessionId`, and the daemon requires matching row ids. Its staged rows carry them.
- The sessions Markdown scene and both cross-build scenes are touched through the Markdown proof's turn and stop checks, and through the viewer's reopen and Save paths.

## The scenes ux-wave runs on a Mac

| group | spec | scene, by title |
|---|---|---|
| `e2e:default` | `e2e/sessions.spec.ts` | "a link in a shown Markdown file opens a file from outside the session's folder, editable, and the tab comes back" |
| `e2e:default` | `e2e/sessions.spec.ts` | "a link in a subagent's transcript, clicked in its drill-in, opens a file from outside the session's folder, editable, and saves" |
| `e2e:cross-build`, `--peer-exact f1852de3a` and `--peer-exact 2c7044231` | `e2e/cross-build.spec.ts` | "(a followed link, both ways) …" (new) |
| the same two runs | `e2e/cross-build.spec.ts` | "(outside file, on the peer's daemon) …" (gains a step; it needs the profile's unit, so check that it does not take its `UNIT_SKIP` branch) |
| `e2e:agents`, `e2e:transcript`, `e2e:lane-a` | unchanged | run because `Transcript.tsx` gives a child's rows another `openFile` |
| `e2e:code` | `e2e/code-tools.spec.ts`, `e2e/code-editor.spec.ts`, unchanged | run because `readChunk` and `kinds.ts` are edited |

Also owed on a Mac: the macOS-guarded unit cases named under Verification.

Watch on the first run: the subagent scene's drill-in, for an agent known only from disk in a session nobody holds. No real-app scene has opened one before. If it fails there, the fallback is X-168's terminal holder.

## Unresolved review findings (for the panel)

Each was triaged at a frontier and left, with its reason:
- **The links store repeats grants' lifecycle** (`src/services/files/links.ts` beside `grants.ts`): session filtering, write-failure handling and reconcile. Dismissed by design: decision 2 keeps `grants.ts` unedited, so that a fault in one store cannot lose the other's entries.
- **The differential prints sample diagnostics on a pass** (`src/renderer/src/tools/code/named-links.test.tsx`). This is test noise and changes no result.
- **The spine's teardown tests print a closed-database diagnostic and a Zod dump on a pass.** This predates the landing.
- **An exception thrown by `located` itself is not guarded** (`src/services/files/service.ts`, the agent proof). Its one caller passes a closure that cannot throw.
- **`retrying` is held on a ready read-only entry for the length of W1 (g)'s read again** (`viewer-store.ts`). Nothing draws it, since Retry is drawn only on an errored entry.
- **K6's second negative follow in `viewer.test.tsx` proves little beyond the first,** since the fake disk answers from a preset list.
- **`service.test.ts` is about 4,430 lines.**

## Confusions

- The `pgrep -f 'vmcheck.sh <branch>'` wait loop matches its own shell's command line, so it never ends. `pgrep -f '[v]mcheck.sh <branch>'` does not have this problem.
- vmcheck keeps one checkout per branch, so two concurrent calls on one branch clash. Every call for this branch was serialized.
- A snapshot write switch once left that checkout dirty; ux-wave has since made vmcheck force-clean it.

## Residue

- **A heading's fragment, and `notes.md:7`.** `[x](#usage)`, `[x](guide.md#usage)` and `[n](notes.md:7)` all open nothing: the first two read as file names, and the third reads as a URL scheme. A README's table of contents is made of the first kind. Opening the file and going to the heading is a design of its own (Q5; tracker row of 2026-11-19).
- **A session on another machine follows nothing (Q6).** After U6f, an owner could open such a file there by that machine's evidence. Offering `files.follow` there needs U6f's grade and the machine test lifted in `follow.ts` (§I).
- **A follow the window gave up on can still record (Q18).** Closing it means carrying a request's expiry to the daemon, which is the host's work (tracker row).
- **The brief's load list should gain `markdown-runs.test.ts` and `test/react-compiler.test.ts`.** Both failed under the whole suite's load on the VM and pass alone.
- **The minor's chain merge.** When batch 5's union lands and master is merged, this landing's 58 becomes 60 in the stand-in style (Decision Log 15).

