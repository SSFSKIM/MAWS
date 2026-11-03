# P5 O17's remote stage (M9, M10): the executor's report (2026-11-03)

> The execution document is `docs/doperpowers/plans/2026-11-01-p5-o17-browser.md` (P5, child O17). Its Progress, Surprises & Discoveries, Decision Log and Outcomes & Retrospective are the record. This report gives the account of how the stage ran, with the gate run ids and what is left. Branch `p5-o17-remote`, cut from master `8db3d9afd`, where the local stage had landed as PR #450. Master `14298d09d` was merged in at `e7b2f5286`.

## What was built

After this stage, a person on another machine can open a session whose machine runs no MAWS app. That person sees the agent's browser tabs live in the Browser tool. With a grant, they can click, scroll and type into those tabs. The tab keeps running on the session's machine, so it still reaches that machine's `localhost`. When the session's machine does run an app, the app serves its agent tabs too: tabs reserved to or leased by a live cua connection, never the person's own.

- **M9a, the carriage.**
  - RL2 1.8 with `rl2.browser-screencast`.
  - The `browser.screencast` read kind on O7 M5b's read open. Its stream row is at `view`, or at `approve` by effect for control. A controlling open must name a done `machine.browserControl` act, checked against the endpoint's own ledger.
  - The frame envelope in org-protocol, and the backlog of one frame plus 4 KiB.
  - The `browser.inventory` feed, and `EndpointServices.browser` with the exact seam pin.
  - One table mapping `mawsd`'s words to RL2's hyphenated ones.
  - The device's `openBrowserStream`.
  - O10's four pins, tested over the real authorizer.
- **M9b, the producers and the bridge.**
  - `mawsd`'s relay selects an app that lists `browser.engine`.
  - The app is the tab engine of its agent tabs. A hidden or throttled tab paints while it is viewed.
  - `browserEngine.request` is kept off the windows.
  - The bridge `browser.remote.*` carries a machine-readable view kind.
  - `daemon.e2eBrowserView` proves the app engine end to end on the daemon shape (WIRE 3.24).
- **M10, the remote Browser view.**
  - An "Agent on <machine>" group in the Browser tool's strip, with the screencast canvas.
  - Take control and Give back.
  - Input mapped through the fitted image: keys, IME, the Character Viewer, paste and Enter.
  - Every state worded from main's view kind.
  - The two-profile scenes in `e2e:remote`.
- **Found and fixed beside the milestones:**
  - **The session sockets' sun_path overflow**, on master since #450 (Surprises). Any Mac user name of 5 or more characters left the headless browser dead. The fix names `mawsd`'s sockets by digest, and `mawsd` passes the render host's path in `prepare`.
  - **The shared producer's Enter.** It did nothing on a form or a text area, which also affected the local stage's takeover.

## How it ran

The controller ran doperpowers:subagent-driven-execution. It used one opus executor per task. Task reviews ran on sol for M9a, then on opus once sol hit its usage limit (06:35Z on 11-04). The architect ruled at each fork.

| Step | Commits | Review | Gates |
|---|---|---|---|
| Refresh pass | `979065540`, `20bae5b05` | 14 corrections and the gaps folded into the Decision Log; M9 split into M9a and M9b | — |
| M9a | `cae501db3`..`07333e131`, fix `ed31e398f` | one round: two Important, one Minor | class 1a 41623283583 |
| M9b | `7e0372207`..`3f2d94bef`, fixes `1a1f6dcc0`, `d64fdf80d`..`41dd1c30b` | one round (opus): one Critical (the app failed to start on the embedded shapes), one Important, four Minor, plus the architect's frame-stall fix | class 1a 41640375917; `e2e:browser-cua`, `e2e:supervisor`, `e2e:cross-build` 41637470700 |
| M10 | `31a8e1bcb`..`28b196f98`, fixes `cb533dfd4`..`12882615a` | one round (opus): four Important, ten Minor | class 1a 41666903982; `e2e:remote`, `e2e:browser-cua`, `e2e:cross-build` 41666888820, no retries |
| Socket names | `063b56ea4`, `27808431b`, follow-up `389904eb8` | approved (opus), five Minor follow-ups | class 1a 41663201980; e2e 41663187635 |

The architect's rulings over the stage, each recorded in the Decision Log:
- The strip with an "Agent on <machine>" group.
- The controlling grade.
- The hyphenated wire words.
- RL2 and WIRE each re-taken at landing.
- The frame stall fixed now; the stale ack deferred.
- WIRE 3.24 for the e2e seam.
- The landing gate is `--gates all`.
- Five scenes held below e2e.
- The socket fix.
- The Korean-input cases.
- The flaky-pass rule.
- The measured confirmation set.

## The landing

- **The landing gate**, `--gates all --class1a pool --runner macos --label o17-l2`, ran as run 41670695707 on `3612b8fb2` (tree `0a99694f2`).
  - **Attempt 1:** every job was green except two.
    - `packaged 2/2` failed `e2e/smoke.spec.ts:111` (job 126038217695). This is a race in master's test, explained in the spec's Surprises; the findings are at `~/.local/share/maws-ci-o17/smoke-window-findings.md`. In the same run, `e2e:default` passed the same test on this branch's daemon-shape build (job 126067610501, 62 passed).
    - `e2e:browser-comment` was cancelled by a `download-artifact` hang on the mini's VM guest.
  - **Attempt 2**, the architect's rerun of the two jobs:
    - `packaged 2/2` was green (job 126067519886, 120 passed, smoke:27 with no retry).
    - `e2e:browser-comment` was cancelled again by the same hang (job 126067521015). Its gate follows on the PR's head once CI-opt clears the guest.
- **The whole-branch review** was the architect's xhigh panel, `wf_67e76ba4-e20`, on fable lanes (sol was out), over `14298d09d..3612b8fb2`.
  - Verdict: "incorrect", with two P3 findings and nothing above. Both are debt, listed below.
  - The control-grant chain, the agent-tab privacy boundary and frame credit across the path came back clean, so the loop stops there.
- **The measured confirmation set** runs through the architect and CI-opt on the landing tree.
- **Versions:** RL2 1.8 and `WIRE_MINOR` 24 on the branch. Both are re-taken at the merge as master's minor plus one.

## Unresolved review findings (for the PR; the architect makes each a tracker row)

- **Panel P3 scalpel-2#1: the app engine pushes no inventory on a selection-only change.** `setSelected` only calls `markSession`, and the engine listens to `onUpdated` and agent-tab changes, not `browser.tabs.changed`. As a result `inventory.selected` goes stale, and the two engines disagree on it. The only effect is the default-pick hint after the shown tab closes (`src/main/browser/engine.ts`).
- **Panel P3 scalpel-4#1: the renderer acknowledges a replaced stream's frame.** `#draw().finally` acks on generation alone, and `#select` does not bump the generation. A frame drawn mid-switch can therefore ack frame 1 of the new stream, giving one extra frame of credit that heals at the next ack. It belongs to the same family as main's stale-ack item below. The fix is to capture the shown `{tabId, epoch}` in `#draw` (`src/renderer/src/tools/browser/remote/client.ts`).
- **`e2e/smoke.spec.ts:111`'s flaky pass on hosted `packaged 2/2`.** This is master's test race; its fix is the architect's own master PR.
- **A web-cards browser stream open reads `grade` on the wire.** The authorizer says `class`, but `STREAM_REFUSALS` has no `class` word. Add one when a web-cards client gets a browser view (`src/endpoint/stream-browser.ts`, `apps/org-protocol/src/messages.ts`).
- **`machine.browserControl`'s ledger row has a null `target`** (`src/endpoint/endpoint-actions.ts`). A same-member `opQuery` therefore sees `{appSessionId, epoch}`. Only the same member can see it.
- **A stale ack can refund a replaced stream's frame** (`src/main/browser/remote-view.ts`). An ack carrying a replaced stream's seq refunds the new stream's outstanding frame, one extra frame at most. Fixing it needs a stream id in `browser.remote.ack`, which is §K's shape.
- **Five of M10's scenes are held below e2e** (the architect's two rulings):
  - the view-only member, the non-owner's step-up and the revocation (M9a's endpoint and lane-B tests);
  - the slow carrier (M9a's backlog test);
  - the peer without `rl2.browser-screencast` (M9a's `not-offered` and `View.test`).
  
  The second fake sminos member would cost well over two hours, and the scene has no carrier throttling or cross-build pairing.
- **M10's deferred minors:**
  - The wheel is not coalesced.
  - Control is kept while the agent view is hidden, which holds `control_busy` for others. Multi-person coordination comes later.
  - `e2e:remote`'s steps 4 and 5 observe less than they claim: the feed's end on B, "clicks reach nothing", and a 30 s "next frame" poll.
  - The collapsed-panel toggle has no unit test.
- **M10's re-review minors:**
  - The `unknown` copy, "the tab is no longer open" (`remote/View.tsx:97`), misstates a controlling open that was refused because the endpoint's ledger no longer holds its grant.
  - The canvas yields on a selection change, so a forwarded link that reuses the hidden selected tab shows nothing (it needs a reveal signal). And once any local tab has been selected, the agent view no longer shows by itself after the local tabs close.

## Residue

- **The app's own cua socket, `<userData>/browser/cua/<uuid>.sock`.** On a Mac's default profile it is 94 + len(user) bytes. With the app attached, it refuses by name for user names of 10 or more characters ("the browser socket of this session is longer than a Unix socket allows"). `mawsd` relays to the path the app computes, so this is a cross-build convention. Shortening it needs a versioned rename, which is its own ticket.

## Friction

- **Sol's usage limit.** Sol reached its usage limit on every Codex account until 06:35Z on 11-04. One task review died at its first call and was re-dispatched on opus. The friction tracker's ClaudeUsage entry is updated.
- **The harness's handback enforcement.** It ended the controller's run three times while workers were mid-flight. The architect resumed it each time, and the ledger held the place.
