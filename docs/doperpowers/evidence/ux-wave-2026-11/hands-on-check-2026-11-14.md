# The UX wave: the hands-on check of 2026-11-14 on the Mac mini

The record of one hands-on check of the UX wave's build (`docs/doperpowers/specs/2026-11-12-ux-wave-design.md`). It ran proofs that the landings' execution documents hand to the architect: the measured half of the transcript's anchoring scene, the local latency bench, the crossing between build F and the wave's build by hand, and the Settings dialog's native popup, Esc, quit and classic scroll bars. Everything here was read from logs, from accessibility text or from measured screenshots. A proof this record does not name was not part of the check.

Dates: the check ran on 2026-11-14 (the owner's local day; 23:16Z to 23:58Z). The rulings on it are the architect's, of 2026-11-15 (UTC).

## What ran, and on what

- **Builds.** F is `f1852de3a`, the build that may be gone back to. "Before U2a" is master `aa5c116fe`. "Final" is `79562e965`, tree-equal to master `05ac77535` (pull request #657).
- **Engine** 2.1.322, in a scratch profile.
- **Where.** The Mac mini, with its lane quiet (CI held by its keeper).
- **How.** Driven by a GUI-driving agent (cua) and over ssh.

## 1. The anchoring scene's measured half

`e2e/transcript.spec.ts`, "anchoring", with its measured bounds asserted (`MAWS_TRANSCRIPT_PERF=1`), on the tree before U2a and on the final tree, each launched two ways.

| build | launch | framesP95 | framesMax | frames | drift | domRows | batches | loadMs | blockedInput |
|---|---|---|---|---|---|---|---|---|---|
| before U2a | over ssh | 18.2 | 18.7 | 571 | 0 | 15 | 594 | 227 | 0 |
| before U2a | from a Terminal window | 18.2 | 18.7 | not recorded | 0 | 21 | 591 | 205 | 0 |
| final | over ssh | 18.3 | 18.7 | 572 | 0 | 21 | 598 | 215 | 0 |
| final | from a Terminal window | 18.3 | 18.7 | not recorded | 0 | 21 | 600 | 220 | 0 |

Each of the four runs ended "1 failed", on one assertion only: the frame interval's p95 `<= 17` ms (received 18.2 or 18.3). Every other bound was met: no long task, no blocked input, scrollDelta 0, and domRows 15 to 21 against the bound of 40. The load averages at the runs were between 1.96 and 3.35.

**Reading.** The 17 ms p95 bound is missed by both trees alike and in both launch contexts, so the miss is the machine's display pacing and not the landing; the final tree is not worse than its base. The cause is not known. A display-management utility that runs on that Mac is a suspect, not a finding. The bound itself is a row of `docs/tech-debt-tracker.md` (2026-11-14, "the anchoring scene's measured frame bound").

## 2. The local latency bench (OX7)

`e2e/local-latency.spec.ts` on the final build:

    [local-latency] delta-to-frame p50 25.0 ms p95 38.1 ms (n=600 of 600) · round trip p50 1.5 ms p95 2.2 ms (n=200) · load 2.6

"1 passed". Not run on F.

## 3. The crossing by hand

Build F and the final build on one profile, with a live engine, for what the cross-build group's replayed engine cannot take: a message sent while a turn runs.

**Which case.** At each of three attaches the session was handed over at the attach. The host's log: the client connects with wire 3.46, and the older supervisor exits by the handover about 45 ms later.

**(a) F keeps the session, the final build's app opens it.** F kept a session in the middle of a long command; the final build's app opened the same profile. The next-step row's Send now was offered at once (its title: "Sends this now; what the agent is running keeps running"), and no updating sentence was shown. Pressed: the call's row read "Moved <the command> to the background after 53s", the message's row read "Sent during this turn", the agent answered the message, later the background command's completion arrived, and the turn's last word came. Pass on the written conditions of row 9 of `docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md`.

**(b) The final build keeps the session, F's app opens it.** F's Send now (its title: "Stops the running turn, then sends this") stopped the turn: "You stopped after 44s · 1 tool call". The message was answered, the rows were in order, and no row was missing. Pass.

**The logs.** Neither log held a refusal: the searches for a refusal in main's and the host's logs print nothing, and there are 0 lines "field this build does not know".

**What the final build draws of turns F ran,** read in (b)'s session after the crossing: F's "You stopped after 44s · 1 tool call" reads "You stopped after 44s · Ran a command (1 stopped)" on the final build, and F's "Continued for 1s" reads as the row "Background command … completed".

### Two observations, and their rulings

Ruled by the architect on 2026-11-15 (UTC): row 9 is green, and neither observation blocks swapping the apps.

1. **Not proven, not a fail.** In (a) the turn's line read "Worked for 58s · Ran a command" and the message's row "Sent during this turn". The Purpose of U4a's document says a turn ended by a sent-now message reads "Ended for your message after <t>". The engine process in (a) had been launched by build F, and the final build's Send now title promises that the command keeps running, so an answer inside the same turn may be the engine's own choice. What settles it is the same press on a session the final build launched itself ("Owed to the next live slot", 1).
2. **A bug, board ticket 668 (P2).** After F's Send now had stopped an earlier turn, the final build's app, attached during a later turn, showed "Queue paused because you interrupted" with Resume above a fresh "Next step" row. The paused state crossed the handover and outlived the turn it belonged to.

## 4. Settings: the native popup, Esc, quit, classic scroll bars

The paths of the Settings dialog that nothing in the gate proves on macOS (the tracker's row "UX wave U14 (hands-on checks)"), with the dropped Esc and the classic scroll bars of the tracker's two U7 rows.

- **A choice made in the native menu** of the design-system select, by the keys (Down, then Return): the value changes, the dialog stays, and one click on a section link navigates. Pass.
- **The popup closed by Esc without a choice:** the dialog stays, and the next click navigates. Pass.
- **The popup closed by Return on the current item:** the same. Pass.
- **Quit** (from Cmd-Q to the process's exit, in seconds): baseline 0.154 and 0.147; after the Esc case 0.10; after the Return case 0.227; after a choice 0.231; after all three in one run 0.17; a last run 0.11. The quit does not hang. Pass.
- **Esc with a sheet over Settings.** Settled, Esc closes the sheet alone and a second Esc closes the dialog. Within the sheet's opening frames, of two early presses one closed neither the sheet nor the dialog and one closed the sheet alone. The tracker's row "An Esc pressed within the opening frames of a sheet over Settings is dropped" stands as written, now seen on macOS.
- **Classic scroll bars** (forced by the app's own argument `-AppleShowScrollBars Always`). The bar's track is 15 px. A drag that starts inside Close's box does not move the thumb; a drag that starts on the about 4 px of the thumb to the right of Close's box, within the top 22 px, does move it; a drag that starts below Close does; Close closes the dialog. The tracker's row on Close over the bar's top stands, with this detail: the thumb can still be grabbed on the strip Close does not cover.
- **Widths,** by measuring screenshots, under classic and under overlay bars alike: the dialog 960 px, the index 148.5 px, the body's column from 169.5 to 928.5 (759 px), the track 15 px. No note wraps to two lines from Appearance to Supervisor (Org's note wraps and is outside the measure). Pass.

## What was not run

- The local latency bench on build F.
- A crossing with a thinking turn: a thought of ten seconds or more drawn by one build and read by the other. The check's script had no such step.
- The frame count of the two anchoring runs launched from a Terminal window was not recorded.

## Owed to the next live slot

By the architect's ruling of 2026-11-15 (UTC), two checks go together to the next run with a live engine: the paid live run of the tools group on the artifact-link landing (U6d) if it can carry them, else the next slot on the Mac mini. They are listed here so that neither is lost.

1. **Send now on a next-step row of a session the final build launched itself.** Does the turn end reading "Ended for your message after <t>", or does the message read "Sent during this turn" (observation 1)?
2. **A crossing with a thinking turn:** a thought of ten seconds or more drawn by one build and read by the other.

## What the check taught about its own script

The script itself is kept outside the repository.

1. The launcher lacked `MAWS_E2E_FOREGROUND=1`: under `MAWS_E2E=1` alone the window is transparent and takes no clicks (`src/main/window-show.ts`).
2. A prompt that asks for `sleep 90 && echo SLEPT` gives no long turn: the engine refuses a foreground sleep, and the model moves it to the background within about 10 s. What works: "Run exactly one Bash command, in the foreground (do not run it in the background): python3 -c 'import time; time.sleep(100)' && echo SLEPT. Wait for it, then reply with the single word DONE."
3. A launcher that passes the app's arguments through must pass all of them after its own.
4. A check that the owner's own processes were left alone must compare process ids and start times, not padded process listings.
5. The GUI-driving agent refuses Terminal; a coordinate click does not reach a native popup menu's items (use the keys); and screenshots measured with an image library on the device stand in for an inspector.

The lesson in one line: a hands-on script written from the repository alone has each launcher and each prompt run once before the slot.

## Where this record is cited

- `docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md`: row 9 of "Proof that an executor does not run" (section 3).
- `docs/doperpowers/plans/2026-11-12-ux-wave-U2a-transcript-structure.md`: proofs 2, 3 and 4 (sections 1, 2 and 3, and "Owed to the next live slot").
- `docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md`: the Settings dialog (section 4).
- `docs/tech-debt-tracker.md`: the rows on the design-system select's popup, the dropped Esc, Close over the scroll bar, and the anchoring scene's frame bound.
