# Tech debt tracker

Real but non-blocking findings that were deliberately not fixed when found. Each entry names the owner child, the evidence, and what would close it. Items are removed when closed, with the closing commit noted in the charter's Decision Log if the closure changed a contract.

| Logged | Owner | Item | Evidence | Closes when |
|---|---|---|---|---|
| 2026-09-28 | C1 | The renderer echo test `src/renderer/src/App.test.tsx` is flaky under full-suite load: fails intermittently, passes in isolation and on the untouched base. | Reported by C5's executor during M1 on `worktree-agent-a3f9c764b1656a780`; reproduced on the C1 base with the full suite. | The test waits on the echo through a deterministic signal instead of a timing window, or moves to the Playwright smoke where the real IPC round-trip is observed. Owner: C12 finish, unless a wave-2 child touches the file first. |
| 2026-09-28 | C5 | `panel.<appSessionId>` layout key is never deleted from `layout.json` when its session is removed. | C5 hand-back residue 3 (branch e014fd1). | C5's rebase pass or C8a deletes the key on `session.removed` and pins it. |
| 2026-09-28 | C5 | Palette "reveal project" may lose focus to the dialog close; not reproduced. | C5 hand-back residue 4. | Reproduced and fixed, or closed as not reproducible after C7's palette work lands. |
| 2026-09-28 | C5 | 960 px minimum window with a 480 px sidebar and a 640 px panel leaves the main area 0 px wide. | C5 hand-back residue 5. | Region bounds clamp against the window width (C5 rebase pass or C12 finish). |
| 2026-09-28 | C5 | Cost digest replaces with the engine's running total; a resumed engine process restarts its total, so the digest needs a per-process base. | C5 hand-back residue 7; observable only with C3 live. | C5's rebase pass against C3 on master adds the per-process base and a test over a status sequence with a restart. |
