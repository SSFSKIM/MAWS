# The TCC probe (P5 O2 M8, U8 on macOS)

`docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md`, M8 "TCC under launchd" and Concrete Steps 10. The question: when a
session's `claude` runs under `mawsd`, under a LaunchAgent, and touches a TCC-protected folder, which app does macOS's
TCC attribute the access to (MAWS, the binary run as Node, or nothing it can name), and does the plist's
`AssociatedBundleIdentifiers: [dev.maws.app]` change that? Until the probe has run, the plist carries
`AssociatedBundleIdentifiers` for its Login Items grouping only.

**The probe raises TCC dialogs.** Run it only at the Mac, with the owner present, and only with the architect's go.
Never on the owner's MacBook unattended, never from an agent session, never in CI.

## The Mac

- A Mac with a console (GUI) login of the account that will run MAWS: the probe's LaunchAgents load into
  `gui/<uid>`, and a TCC dialog needs someone at the screen.
- A packaged MAWS of this branch, built with `pnpm build:app` and copied to `/Applications/MAWS.app` (any path works with
  `--app`; `/Applications` is the recommended place, M8 "The unit's program path"). Its bundle id is `dev.maws.app`.
  An unsigned (ad hoc) build is fine and is what the probe records: TCC keys an ad hoc signature on its code hash, so
  record which build ran.
- Node 22 or newer for the probe itself (`node spikes/mawsd-tcc/probe.mjs` from a checkout of this branch; no
  `pnpm install` needed). The terminal running it never touches the protected folders.

For a first-time answer, ~/Documents and ~/Desktop must hold no grant for MAWS yet. The probe does not reset TCC; if
the owner wants a clean slate, they run `tccutil reset SystemPolicyDocumentsFolder dev.maws.app` and
`tccutil reset SystemPolicyDesktopFolder dev.maws.app` themselves beforehand and say so in the record.

## Running it

    node spikes/mawsd-tcc/probe.mjs --app /Applications/MAWS.app --owner-present

1. **Stage A, the unit's program.** A LaunchAgent `dev.maws.mawsd.tcc-probe-<id>-a` runs
   `MAWS.app/Contents/MacOS/MAWS --disable-sigusr1 <child>` with `ELECTRON_RUN_AS_NODE=1` and
   `AssociatedBundleIdentifiers [dev.maws.app]`, as the unit's plist does; the child runs `/bin/ls ~/Documents` and
   `/bin/ls ~/Desktop`. If a dialog appears, the owner reads which app it names, answers it as they would, and then
   answers the probe's four questions in the terminal.
2. **Stage B, the engine host's spawn path.** A LaunchAgent `dev.maws.mawsd.tcc-probe-<id>-b` runs the bundle's own
   `app.asar/out/main/mawsd.js run --unit` for a scratch profile under `/tmp/maws-tcc-<id>/p`, exactly as the unit's
   plist does. The probe connects to that `mawsd`'s engine-host relay as an app would, points the engine binary at a
   stub `claude` (`engine.configure`) and launches a session (`session.launch`); the engine host spawns the stub as it
   spawns `claude`, and the stub runs the same two `ls`. The session's launch then fails (the stub speaks no
   stream-json); that is expected. The same four questions follow.

Each stage waits up to 3 minutes for its result (a dialog holds the access until it is answered). At the end the probe
boots out and removes both LaunchAgents, ends the scratch profile's engine host and pty host (each checked to name the
scratch root first), and removes `/tmp/maws-tcc-<id>/`. It installs nothing under the default label and never touches
the owner's own MAWS profile or `dev.maws.mawsd`.

## What it records

`spikes/mawsd-tcc/findings.txt` (JSON after a header line):

- the Mac (macOS version, model), the app path, its bundle id and its `codesign -dv` lines;
- per stage and per folder: the `ls` exit status, its first error line (`Operation not permitted` is a denial), the
  number of entries listed, and how long the call blocked (a long block means a dialog held it); the child's pid, ppid
  and runtime path;
- for stage B, the answers to `engine.configure` and `session.launch`;
- the owner's answers: whether a dialog appeared, the app it named in its exact words, what was answered, and which app
  System Settings › Privacy & Security › Files and Folders lists afterwards.

## The verdict

From the record, the controller writes to the O2 document's Surprises which app TCC attributed each stage's access to,
and the decision it implies: for example keeping `AssociatedBundleIdentifiers` as it is, or nothing more being needed,
or a change (another identifier, a responsible-process wrapper) for the architect to rule on. If a grant made during
the probe should not stay, the owner removes it in System Settings.
