#!/bin/zsh
# Production's steps around a deploy (P5 O13 M1, Decision Log 40), beside staging-run.sh and with its mechanism aimed
# the other way: the checkout's deploy/config.json must name exactly production's Worker, host and org, and a staging
# name or a preview alias is refused as not production, before any step runs; every token is read inside this script
# at run time and never printed; output is filtered as staging-run.sh filters it. The owner runs these, never an agent.
# Run each as `zsh apps/desk-hub/deploy/production-run.sh <step>`. The deploy itself is production-deploy.sh.
#   checkout [<path>]   a detached worktree of origin/master at <path> (default ~/.local/share/maws-desk-deploy; never
#                       under /tmp or $TMPDIR, which a sweep empties), added from this checkout or updated in place, then
#                       `pnpm install` of desk-hub and desk-web there; it prints the deploy command for that commit
#   build               production's X-Desk-Build, credential-free
#   wait <sha8>         reads production's X-Desk-Build until it carries hub@<sha8>, for up to 2 minutes
#   access-sync         `deployment access-sync`: production's people policy made the org state's members (an Access
#                       change); needs a production machine enrolled v2 (O14), its credentials in machine.json
#   admin <args…>       `deployment admin <args…>` (O13 M2, O14 M2) against production with the admin device's keys and
#                       the owner's Access token on its stdin; every verb that signs, posts or deletes asks on the
#                       terminal first
#   admin --pipe <verb…> the secret-stream mode, for `delegation create` and `code strip-legacy` alone (the two verbs whose
#                       stdout is a secret code): the token in the command's environment, its stdin and stdout passed
#                       through untouched and unlogged, its stderr alone filtered and logged; refused when stdout is a
#                       terminal. Every line of the runner's own goes to stderr. `delegation create` posts no state: it
#                       signs the delegation into the admin device's pending proposal, which `admin delegation publish`
#                       alone posts (once the stored code decodes under `code inspect`); every other signing verb
#                       refuses until then.
# The steps that change production (access-sync; admin genesis, pair, remove-device, root add, refresh, enroll,
# delegation, machine drop, provisioning revoke, keys) say so first.
# Environment (README "Production runs"):
#   DESK_PRODUCTION_SECRETS  the directory holding CF_ACCESS_SETUP_TOKEN (access-sync)
#   DESK_PRODUCTION_DIR      logs and state (default ~/.local/state/desk-hub-production, 0700): one log per access-sync
#                            and admin run; access-sync/ (access-sync's checkpoint)
#   DESK_PRODUCTION_DEVICE   the admin device's directory (default $DESK_PRODUCTION_DIR/device): keys.json (the admin
#                            command's keys and, beside them, what it writes of its own); machine.json, an enrolled
#                            machine's {"DESK_MACHINE_CLIENT_ID": …, "DESK_MACHINE_CLIENT_SECRET": …}, for access-sync
#   DESK_HEAVY_WRAPPER       a command prefix for the install (a slot limiter, say)
# The owner's production Access token is cloudflared's (`cloudflared access login https://<production host>` once).
readonly PRODUCTION_WORKER=desk-hub
readonly PRODUCTION_HOST=desk-hub.opencognita-platform.workers.dev
readonly PRODUCTION_ORG=ssfskim
readonly STAGING_WORKER=desk-hub-staging
readonly STAGING_HOST=desk-hub-staging.opencognita-platform.workers.dev
HERE=${0:A:h}
W=${HERE:h:h:h}
S=${DESK_PRODUCTION_SECRETS:-$HOME/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers}
O=${DESK_PRODUCTION_DIR:-$HOME/.local/state/desk-hub-production}
H=${DESK_PRODUCTION_DEVICE:-$O/device}
URL=https://$PRODUCTION_HOST
# Before any step: the config is production's by its own words, and staging's or a preview alias's by none.
python3 -B -I -c '
import json, sys
path, pw, ph, po, sw, sh = sys.argv[1:7]
c = json.load(open(path))
worker, host, org = c["worker"], c["host"], c["org"]["id"]
label = host.split(".")[0]
if worker == sw or host == sh or label == sw or label.endswith("-" + sw):
    sys.exit(f"{path} names staging ({worker}, {host}): not production, refusing")
if (worker != pw and worker.endswith("-" + pw)) or (label != pw and label.endswith("-" + pw)):
    sys.exit(f"{path} names a preview alias ({worker}, {host}): not production, refusing")
if (worker, host, org) != (pw, ph, po):
    sys.exit(f"{path} is not production ({worker}, {host}, {org})")
' $W/apps/desk-hub/deploy/config.json $PRODUCTION_WORKER $PRODUCTION_HOST $PRODUCTION_ORG $STAGING_WORKER $STAGING_HOST || { print -r -- "stop: nothing was run"; exit 2; }
umask 077
mkdir -p $O || exit 2
stamp() { date -u +%Y%m%dT%H%M%SZ; }
# Line by line, flushed: a line the owner must read before a /dev/tty prompt (pair's fingerprint) is never held back.
filter() { perl -ne 'BEGIN { $| = 1 } print if /^wrangler target / || !/token|secret|bearer|eyJ/i'; }
# Production's X-Desk-Build, credential-free, within $1 seconds (default 30).
build() { curl -q -sI --max-time ${1:-30} -X POST $URL/machine/enroll | /usr/bin/grep -i '^x-desk-build:' | tr -d '\r'; }
deployment() { pnpm -s -C $W --filter desk-hub deployment "$@" --config deploy/config.json; }
# The same command for the secret-stream mode, launched as the package's `deployment` script launches it but not through
# pnpm, whose recursive runner writes its own failure lines (ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL, the checkout's path) to
# stdout even under -s: there stdout is the secret stream, and holds the command's own output alone.
direct() { ( cd $W/apps/desk-hub && node --experimental-strip-types --disable-warning=ExperimentalWarning deploy/bin.ts "$@" --config deploy/config.json ); }
step=$1; (( $# )) && shift
case $step in
  checkout)
    P=${${1:-$HOME/.local/share/maws-desk-deploy}:A}
    for tmp in /tmp /private/tmp ${TMPDIR:+${TMPDIR:A}}; do
      [[ $P == $tmp || $P == $tmp/* ]] && { print -r -- "$P is under $tmp: a sweep would take it. Name a durable path. Nothing was run."; exit 2; }
    done
    # Git runs in one worktree here, and never in one with uncommitted changes: the checkout itself when it exists,
    # this one when the checkout is added from it.
    clean() { [[ -z "$(git -C $1 status --porcelain --untracked-files=no)" ]] || { print -r -- "$1 has uncommitted changes: stop. Nothing was run."; exit 3; }; }
    if [[ -e $P ]]; then
      [[ $(git -C $P rev-parse --show-toplevel 2>/dev/null) == $P ]] || { print -r -- "$P exists and is not the top of a git worktree: stop"; exit 2; }
      # production-deploy.sh's lock on this checkout: no update while a deploy of it runs, and no deploy during this one.
      LOCK=$(git -C $P rev-parse --absolute-git-dir)/desk-production.lock
      mkdir $LOCK 2>/dev/null || { print -r -- "$P is held by another production run ($(cat $LOCK/holder 2>/dev/null)): stop. If none is running, remove $LOCK. Nothing was run."; LOCK=; exit 6; }
      trap '[[ -n $LOCK ]] && rm -rf $LOCK' EXIT
      trap 'exit 130' INT TERM
      print -r -- "production-run.sh checkout, pid $$ on $(hostname), since $(date -u +%FT%TZ)" > $LOCK/holder
      clean $P
      git -C $P fetch -q origin master && git -C $P checkout -q --detach origin/master || { print -r -- "could not update $P to origin/master: stop"; exit 2; }
    else
      clean $W
      git -C $W fetch -q origin master && git -C $W worktree add -q -f --detach $P origin/master || { print -r -- "could not add a worktree of origin/master at $P: stop"; exit 2; }
    fi
    head=$(git -C $P rev-parse --short=8 HEAD)
    print -r -- "checkout $P at origin/master $head"
    ( cd $P && ${=DESK_HEAVY_WRAPPER} pnpm install --frozen-lockfile --filter 'desk-hub...' --filter 'desk-web...' ) 2>&1 | tail -3
    (( ${pipestatus[1]} == 0 )) || { print -r -- "the install failed in $P: stop"; exit 5; }
    print -r -- "next, the owner: zsh $P/apps/desk-hub/deploy/production-deploy.sh --checkout $P --confirm $head" ;;
  build)
    h=$(build)
    [[ $h =~ '^[Xx]-[Dd]esk-[Bb]uild: hub@[0-9a-f]{8}' ]] || { print -r -- "no valid X-Desk-Build from $URL (read: '${h}'): stop"; exit 3; }
    print -r -- "production: $h" ;;
  wait)
    sha=$1
    [[ $sha =~ '^[0-9a-f]{8,40}$' ]] || { print -r -- "wait needs the commit, as 'git rev-parse --short=8 HEAD' prints it: stop"; exit 2; }
    # 2 minutes of elapsed time: each read and each pause is cut to what is left of them.
    deadline=$(( $(date +%s) + 120 ))
    while left=$(( deadline - $(date +%s) )); (( left > 0 )); do
      b=$(build $(( left < 30 ? left : 30 )))
      print -r -- "$(date -u +%H:%M:%SZ) $b"
      [[ $b =~ "hub@$sha( |\$)" ]] && { print -r -- "production carries hub@$sha"; exit 0; }
      left=$(( deadline - $(date +%s) ))
      (( left > 0 )) && sleep $(( left < 10 ? left : 10 ))
    done
    print -r -- "production never carried hub@$sha within 2 minutes"; exit 1 ;;
  access-sync)
    print -r -- "access-sync changes production: $PRODUCTION_WORKER's Access people policy is made the org state's members"
    (( $# == 0 )) || { print -r -- "access-sync takes no option (given: $*): its deployment and checkpoint are this script's. Nothing was changed."; exit 2; }
    [[ -f $H/machine.json ]] || { print -r -- "no machine credentials at $H/machine.json (DESK_PRODUCTION_DEVICE): the step reads the org state as a production machine enrolled v2 (O14), whose credentials the owner writes there. Nothing was changed."; exit 2; }
    [[ -r $S/CF_ACCESS_SETUP_TOKEN ]] || { print -r -- "CF_ACCESS_SETUP_TOKEN is not readable in $S (DESK_PRODUCTION_SECRETS): stop. Nothing was changed."; exit 2; }
    mkdir -p $O/access-sync
    LOG=$O/access-sync-$(stamp).log
    secrets=$(python3 -B -I -c 'import json,sys; [print(f"{k}={v}") for k, v in json.load(open(sys.argv[1])).items()]' $H/machine.json)
    { print -r -- "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)"; print -r -- "$secrets"; } \
      | DESK_HUB_STATE_DIR=$O/access-sync deployment access-sync 2>&1 | filter | tee $LOG
    rc=${pipestatus[2]}; unset secrets
    print -r -- "access-sync exit $rc; checkpoint: $(cat $O/access-sync/$PRODUCTION_WORKER.json 2>/dev/null); log $LOG"; exit $rc ;;
  admin)
    pipe=0
    [[ $1 == --pipe ]] && { pipe=1; shift; }
    # In the secret-stream mode stdout is the code's pipe: every line of the runner's own goes to stderr.
    say() { if (( pipe )); then print -r -- "$*" >&2; else print -r -- "$*"; fi; }
    sub=$1
    verb="$1${2:+ $2}"
    for a in "$@"; do
      [[ $a == (--config|--keys|--hub|--user|--yes)(|=*) ]] && { say "admin takes no --config, --keys, --hub, --user or --yes: its deployment is production and its keys are DESK_PRODUCTION_DEVICE's. Nothing was changed."; exit 2; }
    done
    if (( pipe )); then
      [[ $verb == ("delegation create"|"code strip-legacy") ]] || { say "admin --pipe is for delegation create and code strip-legacy alone, the verbs whose stdout is a secret code (given: ${verb:-nothing}). Nothing was changed."; exit 2; }
      [[ -t 1 ]] && { say "admin --pipe: stdout is a terminal, and the code goes only to a pipe (… | gcloud secrets create <id> --data-file=-). Nothing was changed."; exit 2; }
    else
      [[ $verb == "delegation create" || $sub == code ]] && { say "admin $verb writes a secret code to stdout, which this step filters and logs: run it as 'production-run.sh admin --pipe $verb … | <its destination>' (code inspect needs no runner: 'pnpm --silent --filter desk-hub deployment admin code inspect'). Nothing was changed."; exit 2; }
    fi
    case $sub in
      genesis) say "admin genesis changes production: it roots the org $PRODUCTION_ORG at $URL (a signed genesis), asking on the terminal first" ;;
      pair) say "admin pair changes production: it adds a device to $PRODUCTION_ORG's org state (a signed successor), asking on the terminal first" ;;
      remove-device) say "admin remove-device changes production: it revokes a device in $PRODUCTION_ORG's org state (a signed successor), asking on the terminal first" ;;
      root) say "admin $verb changes production's roots: it makes a device a root of $PRODUCTION_ORG's org state beside this admin device (a signed successor), asking on the terminal first" ;;
      refresh) say "admin refresh changes production: it posts a no-change successor of $PRODUCTION_ORG's org state" ;;
      enroll) say "admin enroll changes production: it mints an enrollment and lists the machine in $PRODUCTION_ORG's org state (a signed successor), asking on the terminal first" ;;
      delegation)
        if [[ $verb == "delegation create" ]]; then
          say "admin delegation create changes production: it mints a provisioning key at $URL and signs $PRODUCTION_ORG's successor listing the delegation as this device's pending proposal, posting none (admin delegation publish posts it once the stored code is inspected), asking on the terminal first"
        elif [[ $verb == "delegation publish" ]]; then
          say "admin delegation publish changes production: it posts the pending proposal delegation create signed, which puts its delegation in effect for $PRODUCTION_ORG, asking on the terminal first"
        else
          say "admin $verb changes production: it changes $PRODUCTION_ORG's delegations (a provisioning key and a signed successor), asking on the terminal first"
        fi ;;
      machine) say "admin $verb changes production: it takes a machine out of $PRODUCTION_ORG's org state and deletes its hub row, asking on the terminal first" ;;
      provisioning) say "admin $verb changes production: it revokes a provisioning key at $URL, asking on the terminal first" ;;
      keys)
        if [[ $verb == "keys purge" ]]; then
          say "admin keys purge changes production: it deletes every wrapped copy of $PRODUCTION_ORG's org key at $URL, which cannot be undone, asking on the terminal first"
        else
          say "admin $verb changes production: it signs a successor of $PRODUCTION_ORG's org state retiring the legacy org key (--undo: taking the retirement back), asking on the terminal first"
        fi ;;
      abandon-pending) say "admin abandon-pending changes what this admin device signs next: it drops a proposal production never took, asking on the terminal first" ;;
    esac
    if [[ $sub == init || $verb == "code strip-legacy" ]]; then
      # Nothing to sign in with: init makes the device, and strip-legacy is a local transform.
      [[ $sub == init ]] && { mkdir -p $H || exit 2; }
    else
      [[ -f $H/keys.json ]] || { say "no admin device keys at $H/keys.json (DESK_PRODUCTION_DEVICE): run 'production-run.sh admin init' first. Nothing was changed."; exit 2; }
      # The owner's production Access token, into T (never printed; unset after use).
      T=$(cloudflared access token -app=$URL 2>/dev/null)
      [[ -n $T && $T == eyJ* ]] || { say "no production Access token: the owner runs 'cloudflared access login $URL' first. Nothing was changed."; exit 2; }
    fi
    if (( pipe )); then
      # The token in the command's environment alone; its stdout straight to this script's (the pipe), its stdin from
      # this script's; its stderr, the only stream filtered and logged, back to this script's stderr. With no multios,
      # each stream goes to one place.
      unsetopt multios
      LOG=$O/admin-${sub}-pipe-$(stamp).log
      if [[ $sub == code ]]; then
        { direct admin "$@" 2>&1 1>&3 3>&- | filter | tee $LOG >&2; rc=${pipestatus[1]}; } 3>&1
      else
        { DESK_ACCESS_TOKEN=$T direct admin "$@" --keys $H/keys.json 2>&1 1>&3 3>&- | filter | tee $LOG >&2; rc=${pipestatus[1]}; } 3>&1
      fi
      unset T
      say "admin exit $rc; log $LOG (stderr alone: stdout went to the pipe)"; exit $rc
    fi
    # A pairing code goes to the terminal alone (the command writes it to /dev/tty), and the confirmations are read
    # from it. Genesis's output goes to the terminal as it is, unlogged and unfiltered: with `--recovery paper` it shows
    # the org's recovery key once, which no file may keep and no filter may drop.
    if [[ $sub == genesis ]]; then
      { [[ -n $T ]] && printf 'DESK_ACCESS_TOKEN=%s\n' "$T"; } | deployment admin "$@" --keys $H/keys.json
      rc=${pipestatus[2]}; unset T
      print -r -- "admin exit $rc (no log)"; exit $rc
    fi
    LOG=$O/admin-${sub:-none}-$(stamp).log
    { [[ -n $T ]] && printf 'DESK_ACCESS_TOKEN=%s\n' "$T"; } | deployment admin "$@" --keys $H/keys.json 2>&1 | filter | tee $LOG
    rc=${pipestatus[2]}; unset T
    print -r -- "admin exit $rc; log $LOG"; exit $rc ;;
  *) print -r -- "checkout [<path>] | build | wait <sha8> | access-sync | admin [--pipe] <args…>"; exit 2 ;;
esac
