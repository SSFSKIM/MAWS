# The desk, Phase 1 — the recomposition walk (2026-10-16)

Phase 1 of the desk (`docs/doperpowers/specs/2026-10-15-desk-design.md`, the composite, at MAWS master `9cacd717`)
closes when Parent-Level Acceptance 1–12 holds on the owner's two Macs and phone, checked by hand and recorded with
evidence. This sheet is that check. Every child is merged; the hub and the web are deployed at
`https://desk-hub.opencognita-platform.workers.dev`. The walk runs on a build of master that carries the fixes found
while preparing it (branch `desk-walk-fixes`; the build before them was `hub@47fa64ff web@master.47fa64ff`): the
controller deploys it before Part 0, as in F3, and notes its `X-Desk-Build`. The phone walk
(`2026-10-15-desk-dc5-phone-walk.md`) already proved the org key, Access in the home-screen app, and push.

Two people work it. **The owner** does each step on the device it names and writes down each **Record** line in the
sheet at the end. **The controller** (the session that gave you this) captures the machine-side evidence listed under
each part, runs the one redeploy (Part F), and writes Outcomes. A step that does something other than what it says is
a finding: record what you saw, a screenshot or a short screen recording is best, and carry on where you can.

The two Macs are **A**, this MacBook (`macbook` below), and **B**, the Mac mini (`mini`). If you enroll them under
other names, read those names wherever these appear.

Timings ("within 2 seconds") are read from a screen recording with the terminal and the browser side by side
(QuickTime → New Screen Recording, or ⇧⌘5). Start one at the beginning of each part that times something.

---

## Part 0 — setup (the owner, about 30 minutes; nothing here is walked)

What is true now (read on 2026-10-16): both Macs run Claude Code 2.1.302 with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
in `~/.claude/settings.json`, so every session loads the bridge; the MacBook has doperpowers 7.160.2 and the mini
7.162.0, both carrying the bridge (7.155.0), the uplink (7.156.0) and the machine's controls (7.157.0), and neither yet
the walk-prep fixes of 7.162.1 (doperpowers #205); neither runs the sminos daemon or is enrolled; no repository on
either has a `.smns`. Both default to permission mode `auto`, and both run a Bash guardrail hook that allows every
command it does not call destructive, so a permission dialog appears only for a destructive command such as
`rm -rf <dir>` outside `/tmp` (Parts B and H use that).

0.1. **The same plugin on both Macs.** On each Mac, the MacBook and the mini:

        claude plugin marketplace update doperpowers
        claude plugin update doperpowers@doperpowers

   Then `claude plugin list` on each Mac names doperpowers **7.162.1** or later, the same version on both. Restart
   any Claude session you will use in the walk; a session keeps the bridge it started with.

0.2. **sminos in your shell.** It is not on PATH by design. In each Mac's terminal (and in `~/.zshrc` if you like):

        alias sminos=~/.claude/plugins/marketplaces/doperpowers/skills/sminos/scripts/sminos

   sminos runs on the first `python3` on PATH, which must be 3.10 or later; an older one (macOS's own is 3.9)
   stops, saying what fixes it. Both Macs pass today (3.12 and 3.14).

0.3. **The desk.** In Safari on the MacBook open the hub, sign in, **Locked** → unlock with the passkey, and tick
   **Keep unlocked on this device**. The
   fingerprint is `8133-6dc8-be8e`. **Menu** → **Machines**: if `phone-walk` is still listed, **Remove** it.

0.4. **Enroll the MacBook.** **Machines** → **Enroll a machine** → name `macbook` → **Continue** → confirm with the
   passkey → **Copy**. In a terminal on the MacBook:

        sminos hub enroll --name macbook          # paste the code at the hidden prompt, then Return

   Expected: `enrolled this machine as macbook at https://desk-hub… (org ssfskim)`, and a line saying the machine now
   writes as `macbook`, no longer as `SK.local`. Without `--name` it keeps its host name (`SK.local`) whatever the
   dialog said, and the web would show `@SK.local`. The rename touches nothing already written: the local projects'
   old events stay as they are. The code is good for 15 minutes and never goes on the command line.

0.5. **Enroll the mini** the same way, name `mini`: a fresh code from the dialog, then on the mini (at it, over
   Screen Sharing, or `ssh mini` from the MacBook's terminal, which takes a paste):

        sminos hub enroll --name mini

0.6. **The daemon, on each Mac**, from a plain terminal (the service keeps that shell's PATH, from which it starts
   `claude`; on the MacBook use a Terminal.app window, not cmux, whose per-window directory comes first on PATH and
   would wrap every `claude --bg` the daemon starts):

        sminos daemon install                     # prints the Python it pinned into the agent: 3.10 or later
        launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.doperpowers.sminos-daemon.plist
        sminos daemon status                      # the loop and the uplink running

   The Machines dialog then lists each as **enrolled** (not "waiting for its first connection"). The daemon also
   starts working for the Mac's other sminos projects: delivering what is owed, publishing state, and once an hour
   asking unnamed long sessions what they are in charge of (one model call each, at most every six hours).

0.7. **The walk's project.** A scratch repository keeps the walk out of real work. Create a private repository
   `desk-walk` on GitHub with a README, then clone it at the same path on both Macs:

        git clone git@github.com:SSFSKIM/desk-walk.git ~/Developer/GitHub/desk-walk

   On the MacBook:

        cd ~/Developer/GitHub/desk-walk
        sminos project init --hub --name desk-walk
        git add .smns && git commit -m "desk walk: the project names the hub" && git push
        sminos project show                       # note the project id

   On the mini:

        cd ~/Developer/GitHub/desk-walk && git pull && sminos project init --hub

   **Record W0.1:** the project id. In the desk, the grid shows **desk-walk** within a few seconds.

0.8. **Sessions already open need nothing.** A session running in the checkout before the Mac enrolled or before its
   `.smns` named the hub writes to the hub project from its next message, under the enrolled name; no restart.

0.9. **For the controller's reads** (Parts B, F, G): on the MacBook, once, `cloudflared access login
   https://desk-hub.opencognita-platform.workers.dev` (a browser sign-in). It lets `deployment counts` read the hub
   as you.

---

## Part A — presence and messages (items 1, 2)

Open two terminal sessions in `~/Developer/GitHub/desk-walk`:
- on the MacBook: `claude -n walk-a --permission-mode default`
- on the mini: `claude -n walk-b`

A1. **The grid** (item 1). Open the desk's grid. With both sessions idle, the desk-walk card reads "Quiet" and
    "2 machines". On each Mac:

        sminos list desk-walk

    Give walk-a something that runs for a minute (`Run python3 -c 'import time; time.sleep(45)' and then say done`).
    Within 2 s of it starting, the card reads "1 working"; within 2 s of it finishing, "Quiet" again. Do the same on
    walk-b while walk-a runs: "2 working". Run `sminos list desk-walk` on each Mac while both run, and compare: the
    card's working count is the number of `busy` rows across the two Macs whose machine is local there (a remote row
    shows `@<machine>` and its age).
    - **Record W1.1:** the card's counts and each Mac's `sminos list` at three moments (both idle, one busy, both
      busy), and the delay you saw on the recording.
    - Later parts add the waiting count (Part B: a session `waiting` on a question or a prompt counts 1 waiting; an
      async question leaves the session working) and machines online (Part E: "1 of 2 machines online").
      **Record W1.2** there.

A2. **A message** (item 2). Tell walk-a: `Send me a <message> that says "hello from A", then stop.` Open the project
    (`# desk-walk`). The message appears as **walk-a @macbook** with the text, within 2 s of the terminal drawing it.
    Repeat on walk-b (**walk-b @mini**).
    - **Record W2.1:** the delay for each, from the recording, and the attribution line.

**The controller captures:** each Mac's `sminos list desk-walk --json` at A1's three moments, and the lines of
`~/.claude/sminos/daemon.log` from the part's minutes.

---

## Part B — questions and permissions (items 3, 4)

B1. **A blocking question on B** (item 3). Tell walk-b:
    `Ask me with AskUserQuestion, blocking (not async), which colour to use: red, green or blue. Then tell me which you got in a <message>.`
    The terminal on the mini draws the question dialog. In the desk, the question appears in `# desk-walk` and in
    walk-b's channel with its three choices (header "Asks"); the grid card, if you look, shows "1 waiting on you"
    (**W1.2**). Pick **blue** and **Submit** in the web.
    - Expected: the card reads "Answered from the web by you"; the mini's terminal dialog closes within about a
      second; walk-b continues and its `<message>` says blue.
    - **Record W3.1:** what each surface showed, and whether the mini's dialog closed by itself.

B2. **An async question on B.** Tell walk-b:
    `Ask me with mcp__doperpowers__AskUserQuestion with async true which shape to use: circle or square, and meanwhile run python3 -c 'import time; time.sleep(40)'. When the answer arrives, tell me in a <message>.`
    The card is tagged "· it keeps working while it waits". Answer **square** from the web.
    - Expected: walk-b's terminal band of open questions clears; its next step (or its next turn) has the answer, and
      the `<message>` says square. In the desk the question stays drawn with its text, "Which shape…", and
      "Answered: square" under it.
    - **Record W3.2.**

B3. **Deny from the web** (item 4). walk-a runs in `default` mode. Tell it:
    `Create the directory walk-scratch, then run exactly: rm -rf ./walk-scratch`
    The `mkdir` runs without a prompt; the `rm -rf` draws the permission dialog on the MacBook, and the desk shows the
    card ("Wants to run a command", `rm -rf ./walk-scratch`) with **Deny… with a reason**, **Deny**, **Allow**. Click
    **Deny**.
    - Expected: the MacBook's dialog closes; the transcript shows the call denied; `walk-scratch` still exists; the
      card reads "Denied from the web by you".
    - **Record W4.1.**

B4. **Answered in the terminal.** Tell walk-a again: `run exactly: rm -rf ./walk-scratch`. When the card appears in
    the desk, answer **No** in the MacBook's terminal instead.
    - Expected: within 2 s the card loses its buttons and reads "Denied in the terminal". (The settled card stays in
      the chat as a record; what leaves is the pending prompt.)
    - **Record W4.2:** the delay from the recording.

**The controller captures:** walk-a's and walk-b's transcripts (`~/.claude/projects/<cwd slug>/<session>.jsonl` on
each Mac) for the answer rows and the denial; `daemon.log` lines starting `rpc:`; and the hub's audit record, which the
owner reads with the counts command (**W4.3**: the `decided` rows for B3 and B4, `winner` web with the owner's member
id as `by`, then `winner` terminal):

    printf 'DESK_ACCESS_TOKEN=%s\n' "$(cloudflared access token -app=https://desk-hub.opencognita-platform.workers.dev)" \
      | pnpm --filter desk-hub deployment counts --project <W0.1> --audit

---

## Part C — depth and the three verbs (items 5, 6)

C1. **Depth** (item 5). Tell walk-a:
    `Launch two subagents in parallel (run_in_background false): each writes a 200-word story about a lighthouse and returns it. Then add a line "walked" to README.md.`
    Open walk-a's channel. The right column's **Transcript** tab shows the model's text appearing as it is written.
    While the subagents run, **Subagents · 2 running** lists them; click one: its text streams. After the edit,
    **Diff** shows README.md changed, headed "Since <base>". (walk-a runs in `default` mode, so the edit asks first:
    **Allow** it from the card.)
    - **Record W5.1:** each of the three, and whether anything stalled or duplicated.

C2. **Steer** (item 6). Tell walk-a in the terminal:
    `Run python3 -c 'import time; time.sleep(60)' and then tell me you are done.`
    While it runs, type in the desk's composer `After the sleep, also print the word STEERED.` and press **Steer**
    (Enter while a turn runs). The status reads "steered: read at the next model request".
    - Expected: the sleep is not cut short (it runs its full minute); then the model prints STEERED. The MacBook's
      terminal shows the steer as a line.
    - **Record W6.1.**

C3. **Interrupt.** Tell walk-a the same sleep again; after ten seconds click **Interrupt** in the desk.
    - Expected: within 2 s the turn stops in the terminal, and the desk reads "interrupted; stopped a background
      task" (the interrupt also ends the Bash the stop moved to the background). `pgrep -fl time.sleep` on the
      MacBook finds nothing.
    - **Record W6.2:** the delay and the words.

C4. **Send to an idle session.** With walk-a idle, type `Reply with the single word PONG.` and press **Send**.
    - Expected: walk-a starts a turn at once; the terminal draws "Prompt from the doperpowers plugin"; the transcript
      row is that text as yours, after a one-line header `[sminos chat desk-walk hub/<your id>:<n> from human → @you]`;
      the delivery line under your message reads "walk-a: delivered".
    - **Record W6.3.**

**The controller captures:** walk-a's transcript rows for C2–C4 (the steer row's position after the sleep's result,
the interrupt, the delivered prompt).

---

## Part D — spawn, retire, resume (item 7)

D1. **Spawn on B.** In the project, **+ Session** → Machine **mini** → Checkout `…/desk-walk (main)` → Brief
    `walk seat: answers pings` → **Start**.
    - Expected: "Started web-xxxxxx"; within 10 s it is in the sidebar with its in-charge line "walk seat: answers
      pings". On the mini, `sminos list desk-walk` shows it, and `sminos attach web-xxxxxx` (or `claude attach
      <short>`) attaches to it; detach with the engine's usual key.
    - **Record W7.1:** the time to the sidebar, the in-charge line, and the attach.

D2. **Retire it from the web.** In its channel, **Retire…** → **Retire**.
    - Expected: the header reads "Retired by you", the chat line "web-xxxxxx retired by you"; on the mini
      `sminos list desk-walk --all` shows it `retired`, and its job is gone (`claude attach <short>` finds nothing
      running).
    - **Record W7.2.**

D3. **A closed terminal session.** On the MacBook open `claude -n walk-c` in the checkout, tell it `say hi in a
    <message>`, then quit it (`/exit`).
    - In the desk its channel stays, with its message; it shows as ended and offers **Resume**.
    - Send it `are you there?`: the delivery line reads "walk-c: recorded, not delivered".
    - Click **Resume**: "Resumed; it rejoins in a moment". On the MacBook `sminos list desk-walk --json` shows walk-c
      live again under the same `session` id as before (note it before you quit), now a background job you can
      `claude attach`; the delivery line turns "walk-c: delivered" as it reads your message.
    - **Record W7.3.**

**The controller captures:** the seat's record and `joined`/`retired` events (`sminos chat desk-walk -n 20` on the
mini), and walk-c's session id before and after Resume.

---

## Part E — offline (item 9)

E1. On the mini:

        launchctl bootout gui/$(id -u)/com.doperpowers.sminos-daemon

    - Expected in the desk, within a few seconds: walk-b's row muted "offline"; its channel's banner "mini is offline:
      walk-b's presence and depth are unavailable until it reconnects; everything it sent stays here."; its depth
      "Unavailable"; its controls disabled with the tooltip "mini is offline"; the grid card "1 of 2 machines online"
      (**W1.2**). Everything walk-b sent is still in `# desk-walk`.
    - **Record W9.1:** each, and the delay.

E2. Bring it back: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.doperpowers.sminos-daemon.plist`.
    walk-b is live again within seconds. **Record W9.2.**

The acceptance says an RPC to B "fails at once with 'machine offline'". The web disables the controls up front rather
than letting one fail; the hub's own refusal ("mini is offline; nothing was queued") shows only in a race. The
disabled control with its tooltip is the evidence; Part G's console can show the hub's at-once `machine-offline`
too, if the controller wants it.

---

## Part F — no loss across restarts (item 10)

F1. Before anything else in this part, take the counts once (they should agree):

        python3 apps/desk-hub/deploy/machine-counts.py --dir ~/Developer/GitHub/desk-walk > /tmp/macbook.json
        ssh mini python3 - --dir Developer/GitHub/desk-walk < apps/desk-hub/deploy/machine-counts.py > /tmp/mini.json
        printf 'DESK_ACCESS_TOKEN=%s\n' "$(cloudflared access token -app=https://desk-hub.opencognita-platform.workers.dev)" \
          | pnpm --filter desk-hub deployment counts --project <W0.1> --machine /tmp/macbook.json --machine /tmp/mini.json

    (from the root of a MAWS checkout at master, or this branch until it merges). **Record W10.1:** the last line.

F2. Start traffic on both Macs, each in a terminal in the checkout, for about eight minutes:

        for i in $(seq 1 480); do sminos say "F macbook $i"; sleep 1; done      # on the MacBook
        for i in $(seq 1 480); do sminos say "F mini $i"; sleep 1; done          # on the mini

    and post a few untagged lines from the desk as it runs.

F3. While it runs, in this order:
    - **The controller redeploys the Worker** (new code, so the objects restart about five minutes later), from the root
      of a clean checkout of MAWS master:

          pnpm --filter desk-web build
          S=~/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers
          printf '%s\n' "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)" "CF_DESK_HUB_SERVICE_TOKENS=$(cat $S/CF_DESK_HUB_SERVICE_TOKENS)" \
            | pnpm --filter desk-hub deployment deploy --assets "$PWD/apps/desk-web/dist" --web master.<sha>.walk

      The label must differ from the live one (the build the walk started on): Cloudflare restarts objects for new
      code only.
      `--assets` is absolute because pnpm runs the command in `apps/desk-hub`, where a relative path would resolve.
    - Two minutes later, **restart the mini's daemon**: `launchctl kickstart -k gui/$(id -u)/com.doperpowers.sminos-daemon`.
    - Six minutes after the deploy (the objects restart at about +5:15 to +5:30), **reload the desk** in the browser.
    - **Record W10.2:** the new `X-Desk-Build`, and anything the desk showed meanwhile.

F4. When both loops have ended and a minute has passed, take the counts again as in F1.
    - Expected: `AGREE`, every writer's count and last seq the same on both Macs and the hub, each loop's 480 events
      under `macbook/human` and `mini/human`, none twice.
    - **Record W10.3:** the output.

**The controller captures:** the F1 and F4 outputs, the deploy's output and the Worker version it names, both Macs'
`daemon.log` across the window (the reconnects after `stale-generation`), and `uplink.json`'s `spent` on each Mac.

---

## Part G — the machine decides (item 8)

The owner decided this part (2026-10-16): two cases are checked live from a browser console, and three are covered by
the suites named below rather than re-forged by hand. This part runs after Part F, because what the two live cases
forge stays in the hub's log for good (the counts then explain them as refused). Every forgery here carries a wrong
code, so a daemon refuses it `bad-code`; since 7.162.1 an event that verifies but differs from the one a machine holds
at its position is refused `conflict` instead, which nothing here forges.

The live cases use `apps/desk-hub/deploy/walk-console.js`, pasted into the desk's own DevTools console while signed in.
It opens one socket to the walk project, sends exactly two frames — a `human` and a `steer` RPC, each with a wrong
code the org key never signed — prints what comes back, and closes; it sends nothing else and never touches the key,
and it refuses any project but the one you give it. First read the walk-b session's id from `sminos list desk-walk
--json` on the mini, then in the console:

    DESK_WALK = { project: '<W0.1>', session: '<walk-b session id>', machine: 'mini' };
    // then paste the contents of apps/desk-hub/deploy/walk-console.js

G1. **A forged `human`** (the console's first frame). The hub holds no key, so it stores the event and answers
    `human-ack`; each daemon refuses it on import.
    - Expected: the console prints `1. forged human → human-ack`; walk-b does nothing; the project's red banner
      "… refusals in the project's audit record" gains one line per Mac — "macbook refused hub/<your id>:<n>
      (bad-code)", "mini refused hub/<your id>:<n> (bad-code)" — and your own tab says one event failed verification
      and is not shown. **Record W8.1.**

G3. **A forged RPC** (the console's second frame): a `steer` to walk-b with a wrong code.
    - Expected: the console prints `2. forged steer RPC → failed bad-code`; walk-b gets nothing; the mini's
      `daemon.log` has `rpc: steer <nonce> refused bad-code`. The desk draws nothing for an RPC it did not itself send
      (Findings), so the console's line and the daemon log are the evidence, by the owner's decision; drawing such
      refusals in the web is on the backlog. **Record W8.3.**

G2, G4, G5 — **covered by the suites, not re-forged by hand** (the owner's decision). Each is a machine-side refusal
with its own automated proof; the walk records that those suites are green on the current branches rather than
repeating them against the deployment:
- **G2, a forged `say` under another machine's writer.** The hub refuses a machine that uploads a writer not its own
  (`writer-not-yours`), and a daemon refuses an imported event whose code does not verify (`bad-code`) and reports it
  `rejected`. A compromised hub skips its own check, so the daemon's is the one item 8 rests on. Proof: see the
  evidence map below.
- **G4, an Allow whose digest does not match the pending request** (`digest-mismatch`). A card the hub itself altered
  is never drawn — the browser checks the request's code first — so this case lives in the RPC-policy suite, not the
  UI. Proof: the evidence map.
- **G5, a spawn into a directory that is not a known checkout** (`unknown-checkout`). The web's "+ Session" offers
  only known checkouts, so this too is the policy suite's. Proof: the evidence map.

**Record W8.2 / W8.4 / W8.5:** the controller's note that each named suite is green now (the evidence map at the end of
this sheet gives the file, the case, and the command).

G6. **A read-only machine.** First spawn a seat on the mini (+ Session, as D1), then stop its job on the mini with
    `claude stop <short>` so it is a stopped seat. Then on the mini:

        sminos daemon policy --read-only on

    Within a few seconds walk-b's channel says so before you send anything: the banner "mini is read-only: it runs
    nothing sent from outside it, so what you send walk-b is recorded and not delivered…", its Steer, Interrupt,
    Model, Compact and Retire disabled with that reason as their tooltip, and the composer's note "recorded, not
    delivered: mini is read-only"; **+ Session** lists mini as "(read-only)" and does not offer it. From the desk: send
    `ping` to walk-b (live), and `@web-xxxxxx ping` in `# desk-walk` (the stopped seat).
    - Expected: neither starts anything on the mini; each delivery line reads "…: not delivered: the machine is
      read-only — this machine is read-only: nothing written outside it is delivered" (the mini's reason after the
      outcome).
    - Then `sminos daemon policy --read-only off`. What arrived while read-only stays undelivered.
    - **Record W8.6.**

**The controller captures:** the console's printed lines for G1 and G3; the mini's `daemon.log` line `rpc: steer
<nonce> refused bad-code: …` (G3), and each Mac's `uplink: refused 'hub/<your id>':<n> (nonce …) in desk-walk: its
code does not verify for project <W0.1>` for the forged `human` (G1); the counts output with `--audit` after the part
(the `rejected` rows for the forged `human`); the green runs of the named suites (the evidence map below) for G2, G4,
G5; and the mini's `sminos list desk-walk --all` before and after G6.

---

## Part H — the phone (item 12)

On the mini open `claude -n walk-p --permission-mode default` in the checkout (at the mini or over Screen Sharing).
On the phone, the desk app is installed, unlocked, and notifications are on (the phone walk's P2.6–P2.8).

H1. From the phone, open walk-p's channel and **Send**:
    `Wait two minutes with python3 -c 'import time; time.sleep(120)', then ask me with AskUserQuestion (blocking) which fruit: apple or pear.`
    Leave the app for the home screen, put the MacBook's desk tab on the grid and close its lid, and lock the phone.
    (A push is held back while any of your browsers shows the project, and for up to 90 s after it last said so: the
    two-minute wait clears that.)
    - Expected: a notification "walk-p has a question for you", "desk-walk · Opens at the question"; tapping it opens
      the card; answer **pear**; walk-p continues; the mini's dialog has closed (check its screen afterwards, or
      `sminos list desk-walk` on the mini shows walk-p no longer `waiting`).
    - **Record W12.1.**

H2. The same with a permission: send walk-p `Create the directory walk-scratch-p, wait two minutes as before, then run exactly: rm -rf ./walk-scratch-p`. The push reads "walk-p is waiting for your approval"; tap it, **Deny**.
    - **Record W12.2.**

---

## Part I — the desk for a day (item 11)

Pick the project you will really work in for a day (it must be checked out on both Macs). Convert it as in 0.7
(`sminos project init --hub` on one Mac, commit and push the `.smns`, pull and `sminos project init --hub` on the
other); the sessions you keep there write to it from their next message (0.8). Then work the day across both Macs
from the desk, opening a terminal only when something sends you to one.

- **Record W11.1:** your verdict, and each time something sent you to a terminal, what it was.

---

## Item 8's method (the owner's decision, 2026-10-16)

The acceptance says forged events are "placed at the hub without the org key (simulated by writing into the project's
Durable Object directly)". The Worker has no route that does it, and the deploy commands refuse the owner's org. The
owner decided how to prove item 8 without one:

- **Two cases live, from the browser** (G1, G3): `apps/desk-hub/deploy/walk-console.js` opens the owner's own signed-in
  project socket — the path a forging hub would use to reach a machine — and sends a `human` and a `steer` RPC, each
  with a wrong code. The hub checks shape and the signed-in member but never a code, so both reach the machines, where
  they are refused. The snippet sends only those two frames and never touches the org key.
- **Three cases from the suites** (G2, G4, G5): the forged `say` under another machine's writer, the Allow whose
  digest does not match, and the spawn into an unknown checkout each have a machine-side test that asserts the refusal
  code. The walk records that those suites are green on the current branches (the evidence map below) rather than
  re-forging them against the deployment.
- **A forged RPC's refusal is not drawn in the web.** The web draws nothing for an RPC it did not itself send, and the
  hub does not audit a daemon's RPC refusal. Its evidence is the console's printed `rpc-state` and the daemon log
  line; drawing such refusals in the web is on the backlog.

Rejected: Cloudflare Data Studio (hand-writing rows into the production object), and any new hub route or second
Worker — each a standing or manual write path into production for no check the above cannot make.

## Item 8's automated evidence (for the controller)

Before the walk, confirm each suite is green on the current branches, and record the run under W8.2, W8.4 and W8.5.
The doperpowers rows are the real daemon's checks: run them from a doperpowers checkout's root; each suite makes its
own temporary `HOME` and `SMINOS_HOME`, so it never touches the machine's sminos. The MAWS rows run in
`apps/desk-hub` (on the MacBook, inside `/tmp/maws-review/with-slot.sh`); their fake-machine cases show the refusal
code carried back through the hub to the web.

Last confirmed green 2026-10-16: doperpowers main `593ec940` (7.162.1) — `test-sync.sh` 90/90, `test_rpcs.py` 51/51;
MAWS master `1ec4ed6f` — `log.test.ts` 32/32, `fake-machine/replay.test.ts` 7/7.

| Case | Repo | Test file · case | Code asserted | Command |
| --- | --- | --- | --- | --- |
| G2: the hub refuses an upload under a writer not the machine's own | MAWS | `apps/desk-hub/test/log.test.ts` · `refusals` › "refuses a forged writer at that connection and records it in the project's audit record" | `writer-not-yours`, for both `someone-else/<session>` and `hub/<member>`, and the refusal reaches the project's browsers as an audit row | `npx vitest run test/log.test.ts` |
| G2: each daemon refuses a `say` forged under a machine's writer, and reports it | doperpowers | `tests/sminos/test-sync.sh` · block "refused before the log:", assertion "$m reports the say forged under alpha's writer: bad-code, with its position and nonce" (for alpha and beta), with "no forged event enters $side's log" and "or reaches mb" | `bad-code`, reported `rejected` with its position and nonce; nothing enters either log or reaches the session | `bash tests/sminos/test-sync.sh` |
| G2: the hub records a daemon's report and shows it to the browsers | MAWS | `apps/desk-hub/test/log.test.ts` · `refusals` › "records a daemon's report of an event it refused and shows it to the project's browsers" | a `rejected` frame, reason `bad-code` | the G2 hub row's run |
| G4: an Allow whose digest names another command | doperpowers | `tests/sminos/test_rpcs.py` · `Checks.test_e_a_decision_is_bound_to_the_request_still_pending` | `digest-mismatch` for an `allow` whose digest names `pnpm e2e && curl evil \| sh` while `pnpm e2e` is pending (then `not-pending` for a request that is not) | `python3 tests/sminos/test_rpcs.py` |
| G4, through the hub | MAWS | `apps/desk-hub/test/fake-machine/replay.test.ts` · "waits for the web’s decision, checks its digest, settles it as the web’s, and refuses a late one naming the winner" | `rpc-state` failed `digest-mismatch` for a `decide` with an altered input digest | `npx vitest run test/fake-machine/replay.test.ts` |
| G5: a spawn outside the known checkouts | doperpowers | `tests/sminos/test_rpcs.py` · `Checks.test_d_spawn_outside_the_known_checkouts_or_above_the_ceiling` | `unknown-checkout` for a directory that is no checkout of the project, and for a `..` path into another project's checkout | the G4 doperpowers row's run |
| G5, through the hub | MAWS | `apps/desk-hub/test/fake-machine/replay.test.ts` · "answers model, compact (now, or at the turn’s end), spawn, retire, and resume, and serves the diff" | `spawn {checkout: '/nowhere'}` failed `unknown-checkout` | the G4 MAWS row's run |

The live cases' own proof is `apps/desk-hub/test/deploy/walk-console.test.ts` against the local hub (`npx vitest run
test/deploy/walk-console.test.ts`): the snippet sends exactly the two frames and each comes back refused `bad-code`.

---

## Findings to carry into Outcomes (from the audit; none blocks the walk)

- The web keeps a settled permission card in the chat ("Denied in the terminal") rather than removing it; item 4's
  "removes the prompt from the web" is read as the prompt leaving the pending set.
- The web does not draw a refused RPC it did not send, and the hub does not audit daemons' RPC refusals: item 8's
  "the refusal shows in the web" holds for events (the banner) and not for a forged RPC. The owner accepted the
  console's `rpc-state` and the daemon log as the evidence for the RPC, and backlogged drawing it (2026-10-16).
- A send's prompt carries a one-line `[sminos chat …]` header before the text (item 6's "whose prompt is the sent
  text").

## The sheet

| | What | Result |
| --- | --- | --- |
| W0.1 | The desk-walk project id | |
| W1.1 | Grid counts against each Mac's `sminos list`, three moments, delay | |
| W1.2 | Waiting count (Part B) and machines online (Part E) | |
| W2.1 | `<message>` delay and attribution, A and B | |
| W3.1 | Blocking question on B answered from the web; B's dialog closed | |
| W3.2 | Async question on B answered from the web | |
| W4.1 | Deny from the web: dialog closed, transcript, card | |
| W4.2 | Answered in the terminal: card settled within 2 s | |
| W4.3 | Audit `decided` rows for W4.1 and W4.2 | |
| W5.1 | Transcript streaming, a subagent streaming, the diff | |
| W6.1 | Steer during the sleep | |
| W6.2 | Interrupt: delay, words, no sleep left | |
| W6.3 | Send to an idle session | |
| W7.1 | Spawn on B: time to sidebar, in-charge line, attach | |
| W7.2 | Retire from the web | |
| W7.3 | Closed terminal session: recorded, Resume, delivered | |
| W8.1 | Forged `human` (console) refused by both daemons, banner | |
| W8.2 | `writer-not-yours`/`bad-code` suite green now (evidence map) | |
| W8.3 | Forged RPC (console) refused `bad-code` | |
| W8.4 | `digest-mismatch` suite green now (evidence map) | |
| W8.5 | `unknown-checkout` suite green now (evidence map) | |
| W8.6 | Read-only: live session and stopped seat not delivered | |
| W9.1 | B offline: rows, banner, depth, controls, grid | |
| W9.2 | B back online | |
| W10.1 | Counts before | |
| W10.2 | The redeploy's build; what the desk showed | |
| W10.3 | Counts after the redeploy, the daemon restart, and the reload | |
| W11.1 | The day: verdict, and what sent you to a terminal | |
| W12.1 | Phone: question push, tap, answer, mini continues | |
| W12.2 | Phone: permission push, tap, deny | |
