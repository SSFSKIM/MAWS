# The desk, Phase 1 — the recomposition walk (2026-10-16)

Phase 1 of the desk (`docs/doperpowers/specs/2026-10-15-desk-design.md`, the composite, at MAWS master `9cacd717`)
closes when Parent-Level Acceptance 1–12 holds on the owner's two Macs and phone, checked by hand and recorded with
evidence. This sheet is that check. Every child is merged; the hub and the web are deployed at
`https://desk-hub.opencognita-platform.workers.dev`, build `hub@47fa64ff web@master.47fa64ff`. The phone walk
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
7.162.0, both carrying the bridge (7.155.0), the uplink (7.156.0) and the machine's controls (7.157.0); neither runs
the sminos daemon or is enrolled; no repository on either has a `.smns`. Both default to permission mode `auto`, and
both run a Bash guardrail hook that allows every command it does not call destructive, so a permission dialog appears
only for a destructive command such as `rm -rf <dir>` outside `/tmp` (Parts B and H use that).

0.1. **The same plugin on both Macs.** On the MacBook:

        claude plugin marketplace update doperpowers
        claude plugin update doperpowers@doperpowers

   Then `claude plugin list` on each Mac names doperpowers **7.162.0** (or the same later version on both). Restart
   any Claude session you will use in the walk; a session keeps the bridge it started with.

0.2. **sminos in your shell.** It is not on PATH by design. In each Mac's terminal (and in `~/.zshrc` if you like):

        alias sminos=~/.claude/plugins/marketplaces/doperpowers/skills/sminos/scripts/sminos

   `python3 --version` must print 3.10 or later in that shell (sminos does not import under macOS's own 3.9). Both
   Macs pass today (3.12 and 3.14).

0.3. **The desk.** In Safari on the MacBook open the hub, sign in, **Locked** → unlock with the passkey, and tick
   **Keep unlocked on this device** (Part G's console needs the key kept on the device; it never reads it). The
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

0.6. **The daemon, on each Mac**, from a plain terminal (the service keeps that shell's PATH; on the MacBook use a
   Terminal.app window, not cmux, whose per-window directory comes first on PATH and would wrap every `claude --bg` the
   daemon starts):

        sminos daemon install
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

0.8. **Sessions only after the `.smns`.** A session started in the checkout before its `.smns` existed keeps writing
   to the old local project for its whole life. Open every walk session after 0.7.

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
    (**W1.2**). Pick **blue** and **Submit** in the web (not "Skip": see Findings).
    - Expected: the card reads "Answered from the web by you"; the mini's terminal dialog closes within about a
      second; walk-b continues and its `<message>` says blue.
    - **Record W3.1:** what each surface showed, and whether the mini's dialog closed by itself.

B2. **An async question on B.** Tell walk-b:
    `Ask me with mcp__doperpowers__AskUserQuestion with async true which shape to use: circle or square, and meanwhile run python3 -c 'import time; time.sleep(40)'. When the answer arrives, tell me in a <message>.`
    The card is tagged "· it keeps working while it waits". Answer **square** from the web.
    - Expected: walk-b's terminal band of open questions clears; its next step (or its next turn) has the answer, and
      the `<message>` says square.
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

    (from a MAWS checkout at master, or this branch until it merges). **Record W10.1:** the last line.

F2. Start traffic on both Macs, each in a terminal in the checkout, for about eight minutes:

        for i in $(seq 1 480); do sminos say "F macbook $i"; sleep 1; done      # on the MacBook
        for i in $(seq 1 480); do sminos say "F mini $i"; sleep 1; done          # on the mini

    and post a few untagged lines from the desk as it runs.

F3. While it runs, in this order:
    - **The controller redeploys the Worker** (new code, so the objects restart about five minutes later), from a clean
      checkout of MAWS master:

          pnpm --filter desk-web build
          S=~/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers
          printf '%s\n' "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)" "CF_DESK_HUB_SERVICE_TOKENS=$(cat $S/CF_DESK_HUB_SERVICE_TOKENS)" \
            | pnpm --filter desk-hub deployment deploy --assets apps/desk-web/dist --web master.<sha>.walk

      The label must differ from the live one (`master.47fa64ff`): Cloudflare restarts objects for new code only.
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

This part runs after Part F, because what it forges stays in the hub's log for good (the counts explain it as refused).
It runs once the controller has settled how forgeries are placed (see "Item 8's method" at the end); the steps below
follow the recommended method. Each check's evidence is the desk's refusal banner or status line, the console's
answer, and the refusing Mac's `daemon.log` line.

G1. **A forged `human`.** In the desk's DevTools console, the walk console sends a `human` to `@walk-b` with a
    well-formed code that is not the org key's.
    - Expected: walk-b does nothing; the project's red banner "… refusals in the project's audit record" gains one
      line per Mac: "macbook refused hub/<your id>:<n> (bad-code)", "mini refused …"; your own tab says one event
      failed verification and is not shown. **Record W8.1.**

G2. **A forged `say` under another machine's writer.** With the MacBook's daemon stopped, a script using the
    MacBook's own credential uploads one `say` to walk-b under a new `macbook/<uuid>` writer, with a wrong code; then
    the daemon starts again.
    - Expected: walk-b does nothing; "mini refused macbook/<uuid>:1 (bad-code)", and after the MacBook reconnects,
      "macbook refused macbook/<uuid>:1 (bad-code)" too. **Record W8.2.**

G3. **A forged RPC.** The walk console sends a `steer` to walk-b with a wrong code.
    - Expected: the console prints the hub's `rpc-state` failed `bad-code`; walk-b gets nothing; the mini's
      `daemon.log` has `rpc: steer <nonce> refused bad-code`. The desk itself draws nothing for an RPC it did not send
      (see Findings). **Record W8.3.**

G4. **An Allow bound to another command.** Have walk-a reach the `rm -rf ./walk-scratch` dialog again. The walk
    console signs, with the org key kept on this device, an **allow** whose digest names a different command
    (`rm -rf ./other`).
    - Expected: `digest-mismatch`; walk-a's dialog stays open; nothing is deleted. Then **Deny** from the card.
      **Record W8.4.** (A card the hub altered is never drawn at all: the web checks the request's code first, so this
      signed Allow is the only way to reach the machine's digest check.)

G5. **A spawn outside the known checkouts.** **+ Session** → mini. The Checkout list offers only known checkouts.
    In DevTools, edit the selected `<option>`'s `value` to `/tmp`, pick it again, add a brief, **Start**.
    - Expected: "not a known checkout of this project on mini"; nothing starts on the mini. **Record W8.5.** (If the
      edit does not take, the walk console sends the same spawn.)

G6. **A read-only machine.** First spawn a seat on the mini (+ Session, as D1), then stop its job on the mini with
    `claude stop <short>` so it is a stopped seat. Then on the mini:

        sminos daemon policy --read-only on

    From the desk: send `ping` to walk-b (live), and `@web-xxxxxx ping` in `# desk-walk` (the stopped seat).
    - Expected: neither starts anything on the mini; each delivery line reads "…: not delivered: the machine is
      read-only"; a Steer to walk-b fails "mini is read-only: it runs nothing sent from outside it". The desk does not
      show the machine as read-only before you act (see Findings).
    - Then `sminos daemon policy --read-only off`. What arrived while read-only stays undelivered.
    - **Record W8.6.**

**The controller captures:** each Mac's `daemon.log` lines `uplink: refused` and `rpc: … refused`, the counts output
with `--audit` after the part (the `rejected` rows), and the mini's `sminos list desk-walk --all` before and after G6.

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
other) and restart the sessions you keep there (0.8). Then work the day across both Macs from the desk, opening a
terminal only when something sends you to one.

- **Record W11.1:** your verdict, and each time something sent you to a terminal, what it was.

---

## Item 8's method (for the controller)

The acceptance says forged events are "placed at the hub without the org key (simulated by writing into the project's
Durable Object directly)". The Worker has no route that does it, and the deploy commands refuse the owner's org.
Two methods reach every daemon with exactly what a forging hub would send; the controller chooses.

The literal one is the Cloudflare dashboard's Data Studio (beta), which runs SQL in a deployed SQLite-backed object;
it needs Editor access to the Worker and logs every query in the account's audit log. Nothing is deployed. It writes
storage only, so the object pushes nothing and each daemon reads a forged event at its next handshake (a
`launchctl kickstart -k` of each daemon), and it cannot forge an RPC, which is never stored.

The other places each forgery through the hub's own routes, which check shape and identity but never a code, and is
what G1–G5 above describe:
- a `human` and an RPC (G1, G3) from the owner's signed-in browser, with a well-formed wrong code;
- a `say` under another machine's writer (G2) through that machine's own credential, the one path whose writer
  check the hub enforces;
- the digest check (G4, G5) through an RPC signed with the device-kept key.

None changes the hub or adds a route. The walk console and the G2 script are not in this branch: they write to the
production hub, so they wait for the controller's decision.

---

## Findings to carry into Outcomes (from the audit; none blocks the walk)

- The web keeps a settled permission card in the chat ("Denied in the terminal") rather than removing it; item 4's
  "removes the prompt from the web" is read as the prompt leaving the pending set.
- The web does not draw a refused RPC it did not send, and the hub does not audit daemons' RPC refusals: item 8's
  "the refusal shows in the web" holds for events (the banner) and not for a forged RPC.
- The web never shows a machine's read-only policy; it arrives in the `machines` frame and nothing reads it.
- **Skip** on a question sends an empty answer, which the daemon refuses (`bad-shape`).
- An answered async question draws its question text blank: the log's `question.text` is a list, which the web reads
  as a string.
- The Diff tab shows "No changes against " for a failed diff (the daemon's error is not drawn).
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
| W8.1 | Forged `human` refused by both daemons, banner | |
| W8.2 | Forged `say` under another machine's writer refused | |
| W8.3 | Forged RPC refused `bad-code` | |
| W8.4 | Allow with another command's digest refused | |
| W8.5 | Spawn outside the known checkouts refused | |
| W8.6 | Read-only: live session and stopped seat not delivered | |
| W9.1 | B offline: rows, banner, depth, controls, grid | |
| W9.2 | B back online | |
| W10.1 | Counts before | |
| W10.2 | The redeploy's build; what the desk showed | |
| W10.3 | Counts after the redeploy, the daemon restart, and the reload | |
| W11.1 | The day: verdict, and what sent you to a terminal | |
| W12.1 | Phone: question push, tap, answer, mini continues | |
| W12.2 | Phone: permission push, tap, deny | |
