# The desk against Remote Control: the latency baseline's method and harness

For each load the owner meets, the time from the person's action to useful content with usable controls, on the desk
and on claude.ai/code driving a local Claude Code session through Remote Control (RC). Each load is reported with its
p50 and p95 per cohort, and where the desk is behind, the hop that costs it. The live passes run later, in the owner's
Chrome. This directory holds the method, the harness, and a dry run against the desk's local stand-in.

## Cohorts

Each load that opens something (`app`, `project`, `session`) runs in one of three cohorts, and the table is reported per
cohort:

| Cohort | What it is | Start mark |
|---|---|---|
| cold | A navigation: the page from nothing, with the HTTP cache as it stands (`cache: 'off'` bypasses the cache and the service worker). It covers `/api/me`, the chunks, the device-key gate, the project's state, the subscription and its snapshot. | The navigation's start (`performance.now()` 0) |
| warm | An in-app move with the app already loaded: a click from where the owner would come from. | The click |
| reconnect | In place. Every socket is dropped and the network is taken away until the app shows the drop, then the network is given back. | The browser's `online` event |

An action (send, steer, interrupt, allow/deny, answer, spawn, resume) runs warm. With `cohort: 'reconnect'` it acts the
instant the network comes back, which prices a send or an RPC made right after a return.

**Useful** is the content drawn and the controls that act on it usable, in the frame that paints both:

- **Grid:** tiles and the hub's word "Live".
- **Project:** the channels listed and the socket open.
- **Session:** its transcript rows, an enabled Send, and the socket open. Mid-turn it also needs Interrupt; ended, it needs Resume or the retired line.

## The method, per load

Every mark is taken inside the page on the page's own clock (`lib/probe.mjs`):

- **Start.** The input event the app acts on, at its `event.timeStamp`: `click` for a button, `keydown` for Enter, `wheel` for a scroll, `visibilitychange` for a wake, `online` for a return.
- **Visible effect.** A DOM condition. It is seen at the mutation that meets it and *painted* at the next animation frame, the same convention as the desk's own instrument.

Network frames come from a CDP session, on Chrome's monotonic clock tied to wall time by the `wallTime` of a request
(`lib/net.mjs`). The desk also reports its own raw samples (`window.deskLatency.samples`), and the machine reports its
log lines and transcript rows (`machine.mjs`). Ids join these sources, never times alone:

- the subscription id (`sub`): the open line ↔ `view.*`;
- the send's and the RPC's nonce;
- the request id;
- the repetition's token (`lat<rep><4>`), which the prompt asks the reply to carry and the transcripts show.

| Load | Cohort | Start | End (visible effect) | Hops that explain it | RC counterpart |
|---|---|---|---|---|---|
| app (grid with live presence) | cold, warm, reconnect | nav start / click "Projects" / `online` | tiles + "Live" painted | `app.me`, `app.key`, `grid.socket`, `app.grid`; resources (HTML, JS, `/api/me`) | `/code` list rows painted, no offline banner; list GET, watch SSE. No warm move (the list is always on screen). |
| project open | cold, warm, reconnect | nav to `/p/<id>` / tile click / `online` | channels listed + socket open | `app.me`, `app.key`, chunk loads, `project.caught-up`, `socket.gap`, `online.caught-up` | none: claude.ai/code has no project |
| session open (idle, mid-turn, ended) | cold, warm (switch between opened sessions), reconnect | nav to `/p/<id>/s/<sid>` / sidebar click / `online` | rows + Send enabled + socket open (mid-turn: + Interrupt; ended: + Resume) | timeline: me → key → project start → caught up → subscribed → snapshot → rows; the machine's open line by `sub` (arrival, N, emitted) | `/code/<session>` rows + composer; history GET, WS open, `initialize` reply. Warm: a sidebar row clicked in-page, which skips the hover prefetch (P:93). |
| older history page | warm | the wheel that reaches the top | the list grew, painted | `view.older-page` (rows asked → in) | the same wheel; `GET …/events?cursor=` |
| send → echo, delivered, first token | warm, reconnect | Enter | `echo` (local on both), `row`/`delivered` (desk: the delivery outcome, or the framed row in the transcript), `firstToken`, `reply` | frames: `human`, `human-ack`, delivery, first chunk; `owner.ack`, `owner.delivered`; daemon `delivered` line; transcript rows by token | POST `/events` start and end, the echo frame (same `uuid`), `delivery_update` or `system/status requesting`, first `stream_event` delta, `result`; RC debug `Ingress … uuid` |
| steer | warm | Enter while a turn runs | `echo` (local on both), `steered` | `rpc.steer`; the RPC frames | `steered` (the row read: calibrate), else the frame of it consumed (`user` with `isReplay`) |
| interrupt | warm, reconnect | click Interrupt | `stopped` (button gone), `idle` (at rest) | `rpc.interrupt`; RPC frames | Stop; `control_response` for its `request_id`, `result` |
| permission raised → card | warm | the tool call's row on the machine (transcript `timestamp`) | card painted | `request.row`, `request.drawn`; `session:raised` frame | the same anchor in the RC session's transcript; `control_request can_use_tool` frame |
| allow / deny | warm | click Allow (Deny with `decision`) | card gone | `rpc.decide` | "Allow once" / "Deny"; `control_response`, then `control_cancel_request` |
| answer | warm | click Submit | card gone | `rpc.answer` | option, then submit (calibrate) |
| spawn → first row | warm | click Start | `rpc` ("Open it"), `listed`, then (after "Open it", clicked at once) `row`, `firstToken`, `reply` | `rpc.spawn` | new-session composer, Enter → `firstToken`, `reply`; create POST, `system/init` |
| resume to live | warm | click Resume | listed live + header offers Retire | `rpc.resume`; the next open line | none from the web: RC resumes from the terminal (`claude remote-control --session-id`) |
| tab wake | reconnect | `visibilitychange` → visible | the session view current (`changed`) and useful | `wake.caught-up`, `socket.gap`, `resume.gap`, `socket.reconnects` | the same marks (RC refetches its tail on visible, P:215) |
| network change | reconnect (`app`/`project`/`session` in that cohort) | `online` | useful again | `online.caught-up`, `socket.gap`, `resume.gap` | the same (RC redials on `online`, P:192) |
| hub stream recycle | watch | — | every drop the app shows until useful again | daemon.log recycles (`machine.mjs`), `resume.gap` | none in the page until its 25 s banner |
| deploy | watch | — | the same | `socket.gap`, `resume.gap` | none |

The end mark the tables compare is `useful` for an open, `grew` for an older page, `firstToken` for a send or a spawn,
`steered` for a steer, `stopped` for an interrupt, `decide.gone` / `answer.gone`, and `current` for a wake. The machine-anchored
raise is `raise.machine`: the card's paint less the tool call's row. The others are kept alongside them.

### Clocks

- **The page.** `performance.now()` is monotonic from the navigation's start, and wall time is `performance.timeOrigin + t`. Every start and end mark is on this clock, so a page-to-page figure carries no skew.
- **The frames.** CDP's monotonic time, made wall time through a request's `wallTime`. The anchor is taken from any request; the harness fetches `/favicon.ico` once to make sure of one. The error is about 1 ms.
- **The machine.**
  - **daemon.log:** UTC with ms, on the machine's wall clock, written as each line is.
  - **Transcript rows:** `timestamp`, the engine's clock.
  - **RC debug log** (`--debug-file`): ISO ms.

  On the MacBook all three are the browser's clock. A session on the mini carries the skew between the two Macs. Pass it as `--skew-ms` (mini − MacBook, from `sntp -t 1 time.apple.com` on each); the table names the subtraction, and every mini-to-browser figure carries the error of that estimate, about 10 ms.
- **The desk's cross-clock samples** (`stream.*`, `owner.row`, `request.row`, `session.message`) compare a machine stamp with the browser's clock, so they hold only on the MacBook.

### What is not comparable

- **No RC counterpart.** Project open and resume have none. The desk numbers stand alone.
- **Echo.** Both apps draw it locally before any network, so it measures rendering only.
- **Spawn.** The desk needs a second click ("Open it"), which the harness makes the moment the button shows. RC navigates by itself. The end mark is the reply's first token, which both reach.
- **First token.** Both include the model's time to its first token, so both apps must run the same model and effort. RC's worker batches deltas for 100 ms (`tengu_ccr_stream_event_flush_ms`), and its page commits every 33 ms. Those costs are RC's own and count as end-to-end.
- **RC's server hops.** Anthropic's relay is opaque. Only the page's frames and the machine's debug log bound it, and the RC debug log needs the session run with `--debug-file`, which perturbs it a little.
- **Hover.** RC prefetches a session on hover. The harness clicks in-page without moving the pointer, so a person who hovers first may see RC faster than measured.

## The harness

| File | What it is |
|---|---|
| `build.mjs` | Builds one self-contained run-code script per (target, load), with its configuration baked in |
| `lib/probe.mjs` | The in-page marks; also wraps `WebSocket` so a reconnect can drop the page's sockets |
| `lib/net.mjs` | The frames, through CDP (Playwright page events if CDP is refused) |
| `lib/runner.mjs` | The repetition loop and its helpers |
| `lib/loads.mjs` | Every load, written once against a surface |
| `lib/surfaces.mjs` | The desk's and claude.ai/code's surfaces |
| `lib/desk-selectors.mjs` | The desk's selectors and frame labels |
| `lib/rc-selectors.mjs` | claude.ai/code's selectors, endpoints and frame labels, all in one place and uncalibrated |
| `machine.mjs` | The machine's side of a window: daemon.log, plus RC debug logs, transcripts and the RPC ledger where given |
| `join.mjs` | Joins the runs and the machine into the baseline, per cohort |
| `standin/up.mjs` | The dry run's desk: the local hub, a profile holding the key, two fake machines |
| `standin/rc-mock.mjs` | A page built to the RC guesses, for the dry run of the RC loads only |
| `test/harness.test.mjs` | `node --test spikes/desk-latency/test/*.test.mjs` |

Run one load:

```sh
node spikes/desk-latency/build.mjs --target desk --load session --cohort cold --variant idle \
  --url https://desk-hub.opencognita-platform.workers.dev --project <id> --session <id> --reps 30 --out /tmp/lat/desk-session-cold.js
playwright-cli -s=chrome --raw run-code --filename=/tmp/lat/desk-session-cold.js > /tmp/lat/desk-session-cold.json
node spikes/desk-latency/build.mjs --target rc --load session --cohort cold --variant idle --session session_… --reps 30 --out /tmp/lat/rc-session-cold.js
playwright-cli -s=chrome --raw run-code --filename=/tmp/lat/rc-session-cold.js > /tmp/lat/rc-session-cold.json
```

**Configuration.** Pass any key as `--set key=value` (JSON where it parses), or `--config file.json`:

- `reps`, `pauseMs`, `timeoutMs`, `need` (the marks a repetition must reach to count);
- `cohort`, `variant`, `session`, `sessions`, `project`;
- `prompt` and `longPrompt` (`{token}`, `{seconds}`), `sleepS`;
- `decision` (`allow`, `deny` or `alternate`), `option`;
- `cache: 'off'`, `offlineMs`, `downMs`, `hiddenMs`, `durationMs`, `observeMs`;
- `machine`, `checkout`, `model`, `mode`, `retire` (spawn);
- `environment` (RC spawn);
- `raise: false` (decide a card already pending).

**What a run returns.** A JSON string with every repetition:

- its start mark, and for each visible effect the ms after the start and its wall time;
- its frames' hops (`net`) and the ids it joins on;
- the desk's raw samples (`inApp`);
- a cold load's timeline and resources.

**The machine's side of the same window, and the table:**

```sh
node spikes/desk-latency/machine.mjs --since <first rep ISO> --until <last rep ISO> \
  [--transcript ~/.claude/projects/<dir>/<session>.jsonl]… [--rc-debug /tmp/rc-lat/debug.txt] > /tmp/lat/machine-macbook.json
ssh mini 'cat ~/.claude/sminos/daemon.log' > /tmp/lat/mini-daemon.log    # a mini session's window
node spikes/desk-latency/machine.mjs --log /tmp/lat/mini-daemon.log --machine mini --skew-ms <mini−macbook> --since … --until … > /tmp/lat/machine-mini.json
node spikes/desk-latency/join.mjs /tmp/lat/*-*.json --machine /tmp/lat/machine-macbook.json --json /tmp/lat/joined.json > /tmp/lat/baseline.md
```

**What machine.mjs reads.** It reads daemon.log by default. It reads the daemon's RPC ledger (`--rpcs ~/.claude/sminos/daemon/rpcs.json`: an RPC's claim and outcome times, which daemon.log does not carry) only when the operator passes it, because it sits beside credential-bearing files and only daemon.log is cleared for reading.

**What join.mjs writes.**

- Per cohort, a table: each load's end mark on both apps (n, p50, p95; `*` where n < 20), Δp50 and Δp95, and the desk's costliest hop. The costliest hop is the widest gap between consecutive milestones, in median order, up to the end mark.
- The offenders, worst Δp95 first, each with both apps' timelines.
- A raise table, from the tool call's row on the machine to the card painted.
- The machine's recycles and opens.

## The instrument's additions (`apps/desk-web/src/latency/latency.ts`)

The paths before these started at the subscribe. These cover what a cold load, an action and a return cost before and
around it.

- **`window.deskLatency.samples(since)`.** The last 1000 raw samples, each with its wall time and the id that names its item: the send's or the RPC's nonce, the request, the subscription. The machine's per-open line names the subscription too, so `view.*` joins it exactly.
- **`app.me`, `app.key`, `app.grid`.** From the navigation's start to `/api/me` answered, to the device's org key held (the gate before any project draws), and to the grid drawn.
- **`grid.socket`.** The registry socket, from connecting until its whole grid is in.
- **`project.caught-up`.** From the project's log read and its socket started until the hub's backlog is in and drawn.
- **`socket.gap`, `wake.caught-up`, `online.caught-up`.** The project socket caught up again after a drop, after the tab was shown again, or after the browser came back online. A return that needed no reconnect gives no sample.
- **`view.older-page`.** An older page, from asked until its rows are in.
- **`rpc.steer`, `rpc.interrupt`, `rpc.decide`, `rpc.answer`, `rpc.spawn`, `rpc.resume`.** From sent until its result is in. A failure gives no sample.
- **The overlay.** It lists only the paths measured so far, so it stays small enough to read a phone around.

## The live pass

### Before it

1. The owner attaches the Chrome profile (`playwright-cli attach --extension=chrome`, session `chrome`) and keeps the tab in front. A hidden tab paints nothing, and RC commits every 200 ms while hidden.
2. The throwaway sessions exist (below). Both apps run the same model and effort.
3. **Calibration, about 40 minutes, once.** It settles everything the dry run could not see:
   - **The extension's reach.** Run `--load probe-page --target desk` on the desk. Its `net.mode` should be `cdp` and `anchored` true. If it says `playwright`, frame times carry the relay's delay. Then run `app` cold with `--reps 1`: its marks need the init script (`addInitScript`). If the extension refuses it, the desk's cold rows rest on its own `app.*` and `view.*` samples, which count from the navigation's start, and RC's cold rows have no DOM mark until another way in is found.
   - **The RC DOM.** On claude.ai/code, with a session open, run `--load probe-page --target rc --set observeMs=60000` while the operator sends a prompt, steers, stops a turn, allows a permission and answers a question by hand. From its `dom` outline and `net.kinds`, rewrite `lib/rc-selectors.mjs`:
     - `sessionRow`;
     - `userMessage`, `assistantMessage`, `anyMessage`, `scroller`;
     - `composer`, `stopButton`;
     - `allowOnce`, `deny`, `permissionCard`;
     - `questionOption`, `questionSubmit`;
     - `steerRead`, `disconnected`, `olderButton`.
   - **The RC wire.**
     - The API host and the WS URL; the id spelling in the WS path.
     - Whether frames arrive in an envelope (`created_at`, `sequence_num`).
     - Whether the page's own `user` event comes back once or twice, and whether `delivery_update` rides the WebSocket.
     - Whether the watch is fetch-streamed (then pass `--set streamUrls=watch` for chunk timing).
   - **The browser's limits.**
     - Whether `page.context().newPage()` works through the extension (wake).
     - Whether the RC socket lives in the page, not in a worker (reconnect drops only the page's).
     - RC's retention windows, for the warm switches (P:219).
   - **The RC environment id** for spawn: the `environment` in the new-session URL.

### The passes

Run each load on the desk and then on RC back to back, so both meet the same network. Time per load:

| Load | Reps per app | Per rep | Time, both apps |
|---|---|---|---|
| app cold / warm (desk) / reconnect | 30 / 30 / 20 | 3 s / 4 s / 6 s | 3 + 2 + 4 min |
| project cold / warm / reconnect (desk) | 30 / 30 / 20 | 3 s / 4 s / 6 s | 1.5 + 2 + 2 min |
| session cold (idle, mid-turn, ended) | 30 each | 3–4 s | 12 min |
| session warm switch | 30 | 2 s | 2 min |
| session reconnect | 20 | 6 s | 4 min |
| older page | 10–20 (as the history allows) | 2 s | 2 min |
| send (to the reply), warm / reconnect | 20 / 10 | 12 s / 15 s | 8 + 5 min |
| steer | 15 | 30 s (a 20 s sleep, then the steer) | 15 min |
| interrupt | 20 | 10 s | 7 min |
| permission (raised → card, allow) | 20 | 15 s | 10 min |
| question (raised → card, answer) | 20 | 15 s | 10 min |
| spawn → first token | 10 | 30 s, plus the retire | 10 min |
| resume (desk) | 5–10 | 20 s, plus preparing ended sessions | 5 min |
| wake, desktop (`hiddenMs` 30000, then 300000 for one rep) | 10 | 35 s | 12 min |
| watch: a deploy (desk) | the deploy | about 5 min | 5 min |
| watch: hub stream recycles | passive, beside the rest | — | the window |

That is about 2 h 15 of driving for both apps, plus the calibration. It splits naturally into two windows:

1. **Opens and history:** app, project, session, older page, about 50 min.
2. **Actions and returns:** send through wake, about 85 min.

`machine.mjs` reads each window afterwards. Because n < 20 makes p95 within a sample or two of the max, the expensive
loads (steer, spawn, resume) carry the `*`.

### What needs the owner's hands

- **Tab wake on the phone.** The desk with `?latency` on, a session busy in another app, the phone locked for 1 and for 5 minutes, then woken. The overlay shows `wake.caught-up`, `resume.gap` and `socket.reconnects`. A 60 fps screen recording, timed from the unlock to the content, gives the visible figure on both apps (Claude's app or mobile Safari for RC). About 10 repetitions per app, 20 min.
- **A real network change.** Wi-Fi to the phone's hotspot and back, on the phone, and on the MacBook if wanted. On the MacBook the machine's daemon moves with it. The overlay gives `online.caught-up` and `socket.gap`, the recording gives the visible figure, and daemon.log gives the machine's recycle. About 10 per app.
- **A deploy.** The orchestrator deploys during a `watch` window.
- **Answering prompts in the terminal**, if a load is set to race the terminal. None is by default.

## Throwaway sessions

All of them run on the MacBook, whose clock is the browser's, in a scratch repository made for the pass:

```sh
mkdir -p ~/Developer/scratch/desk-latency && cd ~/Developer/scratch/desk-latency && git init -q && git commit -q --allow-empty -m scratch
```

On the enrolled MacBook a repository with no remote lands in the machine's own project, which keeps the throwaways out
of the owner's projects. For a project of its own, commit a `.smns` (sminos `references/setup.md`). `/tmp/desk-lat/` takes the files a
permission prompt writes.

**On the desk.** Spawn each seat with `sminos spawn` from that directory, or with "+ Session" in the desk, which takes the
permission mode. Use the same model as the RC side; haiku keeps cost and the model's share down.

| Seat | Mode | For | Kept in shape by |
|---|---|---|---|
| `lat-idle` | auto | session idle (cold, warm A), send, steer, interrupt | its turns end on their own. Steer and interrupt start their own turn per repetition (`sleep 20`) |
| `lat-idle2` | auto | warm B, the switch's other session | idle |
| `lat-busy` | auto | session mid-turn, wake, watch | a turn that keeps changing the transcript: "Run `date` in Bash 120 times, one call at a time, saying the time after each", sent again when it ends |
| `lat-ask` | default (asks) | permission and question | each repetition's prompt raises one: `touch /tmp/desk-lat/<token>` and an AskUserQuestion. Check in calibration that no allow rule in the owner's settings pre-approves `touch` |
| `lat-long` | auto | older page | one long history first: ask it for 40 short replies in a row before the pass |
| `lat-end-1…10` | auto | resume, session ended | spawned with a one-line brief, left to finish, then their process ended. Ending the process is not retiring, since a retired session refuses Resume: `pkill -f <session id>` on its `claude` process, found with `sminos list --here` |

**On RC, in the same directory:**

- `claude remote-control --debug-file /tmp/rc-lat/debug.txt` registers the directory as an environment, and claude.ai/code spawns sessions into it. Create each counterpart from the web: the idle one, the busy one, and the asking one in the default mode, chosen in the new-session view (calibrate where it is).
- For a session started in a terminal, use `/remote-control` instead.

**Cleanup:**

- **Desk:** `sminos retire <alias>` for each seat (the spawn load retires its own after each repetition), then `rm -rf ~/Developer/scratch/desk-latency /tmp/desk-lat`.
- **RC:** archive the sessions in claude.ai/code, stop `claude remote-control` (Ctrl-C), and remove `/tmp/rc-lat`.
- **Tabs:** close the extra tabs `wake` opened (it closes its own).

## The dry run on the local stand-in

`standin/up.mjs` brings up the hub under `wrangler dev` behind its stand-in for Access, serving the built desk-web, as
desk-web's e2e-hub suites run it. It sets up an org key in a headless Chrome profile, kept unlocked, and enrolls two fake
machines through that browser:

- one replays the two-subagents recording live and waits for the web's answers (a permission prompt and a question);
- the other plays the session-view recording to its end (older history, an ended session).

`standin/rc-mock.mjs` serves a page built to the RC guesses. The scripts run through `playwright-cli --raw run-code` in a
headless session on that profile, never the owner's Chrome. The numbers mean nothing there. The run proves:

- every script builds, runs in run-code's sandbox and returns its JSON;
- the cold init script, the CDP frames and their anchor, the socket drop and the return all work;
- the joiner reads the output.

The marks a fake cannot produce report themselves missing:

- the fake writes no reply, so `firstToken`, `reply` and the spawned session's `row` never come;
- the fake's turns do not run, so steer and interrupt stop at "never showed as running";
- `wake` needs a headed browser, because headless keeps every tab visible.
