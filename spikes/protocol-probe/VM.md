# Running engine probes on a devcloud VM

A devcloud VM is set up like the owner's Macs, which is wrong for a probe: `/etc/claude-code/managed-settings.json`
routes every engine through the owner's gateway and prepends the owner's plugins (to-human, sminos, doperpowers)
whatever `--setting-sources` says, and the owner's home holds their instructions, skills and credentials. Launch every
probe engine through [`vm-run.sh`](vm-run.sh) instead of calling `node` or `claude` directly. It gives the engine the
configuration of the owner's sessions on the axes a probe reads (Claude Code 2.1.322, routed through the gateway, the
owner's feature-gate cache) and nothing else of the owner's.

## Setup, once per VM

The script installs everything else on its first run (the engine copy under `/opt/maws-probe/engines/`, the loopback
forward). The one input it cannot make is the feature-gate cache, which only a Mac that runs the owner's sessions has.
From that Mac:

    python3 -I -c 'import json,os;o=json.load(open(os.path.expanduser("~/.claude.json")));print(json.dumps({k:o[k] for k in ("cachedGrowthBookFeatures","cachedGrowthBookFeaturesAt")}))' \
      | devcloud vm ssh <vm> -- 'sudo mkdir -p /opt/maws-probe && sudo tee /opt/maws-probe/growthbook-features.json >/dev/null'

## Running

From a worktree's `spikes/protocol-probe/` on the VM:

    ./vm-run.sh --prefix <you> --out /tmp/<you>-fixtures run run-pass3.mjs <scenario>   # a pass-3 scenario
    ./vm-run.sh --prefix <you> --out /tmp/<you>-fixtures run vm-check.mjs               # the checks below
    ./vm-run.sh --prefix <you> -e NAME=VALUE run run-pass3.mjs <scenario>               # a scenario knob (never a secret)

`run` runs `node <args>` in this folder; anything a scenario reads at load (`PROBE_ENGINE`, `MAWS_E2E_ENGINE_BIN`,
`PROBE_MODEL` through `-e`) is set. `--out DIR` moves the harness's fixtures under `DIR` (same relative paths), so a
trial run does not overwrite the committed ones; files a scenario writes itself from `root` are not moved. Without
`--out`, fixtures land in the worktree as usual. The scenario's scratch HOME and working repository are kept under
`/tmp/<prefix>-*/` (`home/.claude/projects/…` holds the engine's transcripts); `PROBE_ROOT` and `PROBE_WORK` name them.

A terminal session (an interactive engine under a PTY):

    ./vm-run.sh --prefix <you> term <you>-t1 --model haiku       # prints the scratch folder; the engine's cwd is its work/
    tmux -L <you>-t1 send-keys -t <you>-t1 'Reply with only the word ready' Enter
    tmux -L <you>-t1 capture-pane -p -t <you>-t1
    tmux -L <you>-t1 kill-server                                 # ends it

It reaches the prompt with no dialog (onboarding, trust of `work/` and the auto-mode notices are pre-set), and starts
in auto mode, as an owner's session does on this engine: the footer reads `auto mode on`. A probe that needs another
mode passes `--permission-mode`.

`--managed` leaves the managed settings in place, for the rare probe that wants the owner's plugins: their skills and
hooks load (and their hook output reaches the frames, so such a fixture needs a careful read before it is committed),
and the route is the managed settings' own. The HOME is still scratch, so the sminos bridge starts but the session does
not appear on the owner's desk.

## What it isolates, and how that is known

Each item is shown by the check run's fixture or by a command below; the recordings are in `fixtures/vm/`
(2026-11-12, VM `dc-uxprobe-dc94`).

- **Engine 2.1.322**, a copy at `/opt/maws-probe/engines/2.1.322` (from the VM's own install, or the official
  installer in a throwaway HOME), with `DISABLE_AUTOUPDATER=1`, so the VM's installation can update without moving it.
  `system/init` reads `claude_code_version: "2.1.322"`.
- **The gateway** through a forward at `127.0.0.1:8641` (the transient unit `maws-probe-forward`, which reads the
  address from the managed settings itself): the address MAWS's launch line uses on the Macs and the one `RELAY_ENV`
  in `c10-common.mjs` and `p1-common.mjs` hardcodes, so those scenarios run unchanged. The token is read into the
  environment and appears on no command line (`ps -eo args` shows none), in no fixture (the harness redacts it, and
  the gateway's host when `--managed`), and in no output. The spawn row reads `routed: true`; the result is a model's
  answer.
- **None of the owner's plugins, skills or MCP servers**: `system/init` lists only the engine's built-in plugins
  (`cc-plugin-agents-md`, `-telemetry`, `-privacy`, `-plugin-authoring`, all `@builtin`), the engine's bundled skills,
  and `mcp_servers: []`. With `--managed` the same check lists `to-human`, `sminos` and `doperpowers@doperpowers`.
- **The feature cache**: the scratch `.claude.json` carries it, and the harness seeds it into any config home a
  scenario makes for itself (the spawn row reads `featureCache: "seeded"` or `"present"`). On 2.1.322 without it,
  `Monitor` is still present but `PushNotification` is not, and the slash commands differ.
- **No instructions file of the owner's**: the masks below hide `~/.claude`, and the working folders are under `/tmp`
  (no `CLAUDE.md` among their ancestors). `vm-check.mjs` puts a `CLAUDE.md` in its own working folder as a control and
  launches with MAWS's setting sources (`user,project,local`): the transcript's `instructions` attachment lists that
  file and no other. Under the harness's default `--setting-sources ""`, no `CLAUDE.md` is loaded at all, the control
  included.
- **Not on the desk**: `sminos list --machine <vm>` before and after a run shows no member.
- **A private mount namespace** (`unshare --mount`, private propagation) hides from the command's processes alone
  `/etc/claude-code` (a tmpfs) and the owner's `~/.claude`, `~/.claude.json`, `~/.config` (gh, gcloud and the secrets
  folder) and `~/.ssh`. Other processes on the VM, the other agents' included, see the host's files.
- **An environment built from nothing**: the base keys, the route, the managed settings' engine switches
  (`ENABLE_TOOL_SEARCH`, `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING`,
  `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`), the `PROBE_*` paths and what `-e` names.

## What it does not isolate

- The engine runs as the owner's user. Outside the four masked paths it can read what that user can (the repository,
  other dotfiles); a probe's prompts stay invented and harmless.
- The network is the host's: the forward is VM-wide, and the tailnet is reachable.
- The owner's user settings are not applied, so their `env` is not either: no model aliases (`haiku` resolves to
  `claude-haiku-5-5`, where the owner's sessions name `claude-haiku-5-5[1m]`), no `CLAUDE_CODE_SUBAGENT_MODEL`, no
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`. A probe whose answer depends on one passes it with `-e`.
- A run not routed through the gateway does not authenticate: the scratch home holds no credential, and the harness's
  `unrouted: true` gets the result `Not logged in · Please run /login` (`fixtures/vm/vm-unrouted.jsonl`).

## The checks, as commands

    sminos list --machine "$(hostname)"                                   # before: no member
    ./vm-run.sh --prefix <you> --out /tmp/<you>-check run vm-check.mjs     # prints the facts; the fixture's vm_check row holds them
    sminos list --machine "$(hostname)"                                   # after: still none
    for p in $(pgrep -f /opt/maws-probe/engines/); do sudo ls /proc/$p/root/etc/claude-code; done   # while one runs: empty

`vm-check.mjs` prints `version`, `routed`, `plugins`, `skills`, `mcpServers`, `monitor`, the result's text (the
control's word, `TEAL`), and `instructionsLoaded` (expected: only `<cwd>/CLAUDE.md (the control)`).
