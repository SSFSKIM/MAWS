#!/bin/zsh
# The live staging runs (P5 O11 M8's phase B, kept for O13's and O14's acceptance): each step against desk-hub-staging
# from the checkout this script is in. Run each as `zsh apps/desk-hub/deploy/staging-run.sh <step>`. Every token is read
# inside this script at run time and never printed; output is filtered as staging-deploy.sh filters it. Never
# production: deploys go through staging-deploy.sh, every command takes `--config deploy/staging.json`, and production's
# Worker and host are refused by name before any step runs.
#   prod <label>             production's credential-free X-Desk-Build into prod/prod-build-<label>.txt; with label
#                            `after`, compared with `before`
#   deploy                   the checkout to staging under staging-ssfskim
#   build                    acceptance 1: staging's and production's X-Desk-Build, credential-free
#   acceptance [--no-push]   `deployment acceptance` under staging-ssfskim (its default items); the push item's sink
#                            behind an account-less quick tunnel (cloudflared tunnel --url), unless --no-push
#   relay-measure            `deployment relay-measure` under staging-ssfskim
#   access-sync              `deployment access-sync`: the people policy read back at the org state's head
#   admin <args…>            `deployment admin <args…>` against staging-ssfskim with the admin device's keys: adopt,
#                            devices, refresh run unattended; pair and remove-device confirm at /dev/tty, and pair's
#                            code goes to the terminal alone, never to the log
#   throwaway <n>            staging deployed under the throwaway org staging-probe-<n>, fake-check and redeploy-check
#                            there, the account swept (staging-sweep.py), staging restored under staging-ssfskim
#   desk-web <n>             the same around acceptance 8's desk-web check (apps/desk-web/e2e-staging) in place of
#                            the two commands: screenshots into desk-web-<n>/
# Any further arguments go to the step's command. Environment (README "Staging runs"):
#   DESK_STAGING_SECRETS  the directory holding CF_ACCESS_SETUP_TOKEN and CF_DESK_HUB_SERVICE_TOKENS
#   DESK_STAGING_DIR      logs and state (default ~/.local/state/desk-hub-staging): one log per step; prod/; the
#                         throwaway snapshots and sweeps; access-sync/ (access-sync's checkpoint)
#   DESK_STAGING_DEVICE   the admin device's directory (default $DESK_STAGING_DIR/device): keys.json (the org's root
#                         device, org-admin.ts) for acceptance, relay-measure and admin (its anchor beside it,
#                         keys.json.org.json, written by `admin adopt`); machine.json (access-sync's machine
#                         credentials, {"DESK_MACHINE_CLIENT_ID": …, "DESK_MACHINE_CLIENT_SECRET": …}) for access-sync
#   DESK_HEAVY_WRAPPER    a command prefix for the web build (passed to staging-deploy.sh)
# The owner's staging Access token is cloudflared's (`cloudflared access login https://<staging host>` once).
readonly STAGING_WORKER=desk-hub-staging
readonly STAGING_HOST=desk-hub-staging.opencognita-platform.workers.dev
readonly STAGING_ORG=staging-ssfskim
readonly PRODUCTION_WORKER=desk-hub
readonly PRODUCTION_HOST=desk-hub.opencognita-platform.workers.dev
HERE=${0:A:h}
W=${HERE:h:h:h}
S=${DESK_STAGING_SECRETS:-$HOME/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers}
O=${DESK_STAGING_DIR:-$HOME/.local/state/desk-hub-staging}
H=${DESK_STAGING_DEVICE:-$O/device}
URL=https://$STAGING_HOST
PROD=https://$PRODUCTION_HOST
# Before any step: the config is staging's by its own words, and production's by none of them.
ACCOUNT=$(python3 -B -I -c '
import json, sys
c = json.load(open(sys.argv[1]))
worker, host, org = c["worker"], c["host"], c["org"]["id"]
label = host.split(".")[0]
if worker == sys.argv[5] or host == sys.argv[6] or label == sys.argv[5] or label.endswith("-" + sys.argv[5]):  # a preview alias too
    sys.exit(f"{sys.argv[1]} names production ({worker}, {host}): refusing")
if (worker, host, org) != tuple(sys.argv[2:5]):
    sys.exit(f"{sys.argv[1]} is not staging ({worker}, {host}, {org})")
print(c["account"])
' $W/apps/desk-hub/deploy/staging.json $STAGING_WORKER $STAGING_HOST $STAGING_ORG $PRODUCTION_WORKER $PRODUCTION_HOST) || { print -r -- "stop: nothing was run"; exit 2; }
umask 077
mkdir -p $O || exit 2
stamp() { date -u +%Y%m%dT%H%M%SZ; }
# Line by line ($| = 1): a step that asks at /dev/tty (admin pair) shows what it asks about before the question.
filter() { perl -ne 'BEGIN { $| = 1 } print if /^wrangler target / || !/token|secret|bearer|eyJ/i'; }
# A deployment's X-Desk-Build, credential-free; stops the script unless it names a hub build.
header() {
  local h=$(curl -q -sI --max-time 30 -X POST $1/machine/enroll | /usr/bin/grep -i '^x-desk-build:' | tr -d '\r')
  [[ $h =~ '^[Xx]-[Dd]esk-[Bb]uild: hub@[0-9a-f]{8}' ]] || { print -r -- "no valid X-Desk-Build from $1 (read: '${h}'): stop"; exit 3; }
  print -r -- $h
}
# The owner's staging Access token, into T (never printed; unset after use).
owner_token() {
  T=$(cloudflared access token -app=$URL 2>/dev/null)
  [[ -n $T && $T == eyJ* ]] || { print -r -- "no staging Access token: the owner runs 'cloudflared access login $URL' first. Nothing was changed."; exit 2; }
}
deployment() { pnpm -s -C $W --filter desk-hub deployment "$@" --config deploy/staging.json; }
step=$1; (( $# )) && shift
case $step in
  prod)
    label=${1:?a label: before or after}
    [[ $label =~ '^[a-z0-9-]{1,20}$' ]] || { print -r -- "bad label $label"; exit 2; }
    P=$O/prod; mkdir -p $P
    h=$(header $PROD) || exit 3
    print -r -- $h > $P/prod-build-$label.txt
    print -r -- "production build ($label): $h"
    if [[ $label == after ]]; then
      diff -u $P/prod-build-before.txt $P/prod-build-after.txt; rc=$?
      case $rc in 0) print -r -- "production build: unchanged" ;; 1) print -r -- "production build: CHANGED" ;; *) print -r -- "production build: COULD NOT COMPARE" ;; esac
      exit $rc
    fi ;;
  deploy)
    zsh $HERE/staging-deploy.sh --checkout $W 2>&1 | filter | tail -12
    rc=${pipestatus[1]}; print -r -- "staging-deploy exit $rc"; exit $rc ;;
  build)
    hs=$(header $URL) || exit 3; hp=$(header $PROD) || exit 3
    print -r -- "staging:    $hs"; print -r -- "production: $hp" ;;
  acceptance)
    [[ -f $H/keys.json ]] || { print -r -- "no admin device keys at $H/keys.json (DESK_STAGING_DEVICE): stop"; exit 2; }
    owner_token
    LOG=$O/acceptance-$(stamp).log
    push=()
    nopush=0; [[ $1 == --no-push ]] && { nopush=1; shift; }
    if (( ! nopush )); then
      PORT=18743
      TL=$O/tunnel-$(stamp).log
      stop_tunnel() {
        [[ -z $TUNNEL ]] && return
        kill $TUNNEL 2>/dev/null; wait $TUNNEL 2>/dev/null
        kill -0 $TUNNEL 2>/dev/null && gone="STILL RUNNING" || gone="process gone"
        print -r -- "tunnel stopped: pid $TUNNEL at $(date -u +%FT%TZ), $gone" | tee -a $LOG
        TUNNEL=
      }
      trap stop_tunnel EXIT
      trap 'exit 130' INT TERM
      cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT > $TL 2>&1 &
      TUNNEL=$!
      print -r -- "tunnel started: pid $TUNNEL at $(date -u +%FT%TZ)" | tee -a $LOG
      for i in {1..45}; do
        PUBLIC=$(/usr/bin/grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' $TL | /usr/bin/grep -v '^https://api\.' | head -1)
        [[ -n $PUBLIC ]] && /usr/bin/grep -q 'Registered tunnel connection' $TL && break
        kill -0 $TUNNEL 2>/dev/null || break
        sleep 1
      done
      if [[ -z $PUBLIC ]] || ! kill -0 $TUNNEL 2>/dev/null; then
        print -r -- "the quick tunnel did not come up by $(date -u +%FT%TZ): $(/usr/bin/grep -iE 'fail|error' $TL | head -2): stop" | tee -a $LOG; exit 2
      fi
      print -r -- "push sink: $PUBLIC -> 127.0.0.1:$PORT" | tee -a $LOG
      push=(--push-url $PUBLIC/staging-run --push-port $PORT)
    fi
    printf 'DESK_ACCESS_TOKEN=%s\n' "$T" | deployment acceptance --device-keys $H/keys.json "${push[@]}" "$@" 2>&1 | filter | tee -a $LOG
    rc=${pipestatus[2]}
    (( nopush )) || stop_tunnel
    unset T
    print -r -- "acceptance exit $rc; log $LOG"; exit $rc ;;
  relay-measure)
    [[ -f $H/keys.json ]] || { print -r -- "no admin device keys at $H/keys.json (DESK_STAGING_DEVICE): stop"; exit 2; }
    owner_token
    LOG=$O/relay-measure-$(stamp).log
    printf 'DESK_ACCESS_TOKEN=%s\n' "$T" | deployment relay-measure --device-keys $H/keys.json "$@" 2>&1 | filter | tee $LOG
    rc=${pipestatus[2]}; unset T
    print -r -- "relay-measure exit $rc; log $LOG"; exit $rc ;;
  access-sync)
    [[ -f $H/machine.json ]] || { print -r -- "no machine credentials at $H/machine.json (DESK_STAGING_DEVICE): stop"; exit 2; }
    mkdir -p $O/access-sync
    secrets=$(python3 -B -I -c 'import json,sys; [print(f"{k}={v}") for k, v in json.load(open(sys.argv[1])).items()]' $H/machine.json)
    { print -r -- "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)"; print -r -- "$secrets"; } \
      | DESK_HUB_STATE_DIR=$O/access-sync deployment access-sync "$@" 2>&1 | filter
    rc=${pipestatus[2]}; unset secrets
    print -r -- "access-sync exit $rc; checkpoint: $(cat $O/access-sync/$STAGING_WORKER.json 2>/dev/null)"; exit $rc ;;
  admin)
    [[ -f $H/keys.json ]] || { print -r -- "no admin device keys at $H/keys.json (DESK_STAGING_DEVICE): stop"; exit 2; }
    # The step names the deployment and the keys itself; staging's admin device is O11's test device, adopted, not made.
    [[ $1 == init ]] && { print -r -- "admin init: staging's admin device exists ($H/keys.json); run admin adopt: stop. Nothing was changed."; exit 2; }
    for a in "$@"; do
      [[ $a == (--hub|--user|--yes|--config|--keys)(|=*) ]] && { print -r -- "admin takes no $a here: the step acts on staging with $H/keys.json, confirming at /dev/tty: stop. Nothing was changed."; exit 2; }
    done
    owner_token
    LOG=$O/admin-$(stamp).log
    printf 'DESK_ACCESS_TOKEN=%s\n' "$T" | deployment admin "$@" --keys $H/keys.json 2>&1 | filter | tee -a $LOG
    rc=${pipestatus[2]}; unset T
    print -r -- "admin exit $rc; log $LOG"; exit $rc ;;
  throwaway|desk-web)
    n=${1:?a run id}; shift
    [[ $n =~ '^[a-z0-9-]{1,20}$' ]] || { print -r -- "bad run id $n"; exit 2; }
    # The desk-web check passes nothing on: a Playwright option (--trace=on, --debug, …) would record the browser that
    # holds the owner's token.
    [[ $step == desk-web && $# -gt 0 ]] && { print -r -- "desk-web takes no option (given: $*): stop. Nothing was changed."; exit 2; }
    org=staging-probe-$n
    LOG=$O/$step-$n.log; : > $LOG
    # What the desk-web check saw besides the token (the enrollment code, its token, the org key), one a line, for the
    # scan below; removed with the run.
    SCAN=$O/$step-$n.scan; : > $SCAN
    say() { print -r -- "$*" | tee -a $LOG; }
    owner_token
    cat $S/CF_ACCESS_SETUP_TOKEN | python3 -B -I $HERE/staging-sweep.py snapshot $ACCOUNT $O/$step-$n-before.json | tee -a $LOG
    (( ${pipestatus[2]} == 0 )) || { say "snapshot failed: stop. Nothing was changed."; exit 2; }
    # From here, however the script ends (a failure, INT, TERM): the sweep is attempted and staging restored, once.
    # `checks` holds each check's exit status; none ran is a failure.
    deployed=1 checks=() finalized=0
    finalize() {
      local first=$?
      (( finalized )) && return; finalized=1
      rm -f $SCAN
      cat $S/CF_ACCESS_SETUP_TOKEN | python3 -B -I $HERE/staging-sweep.py sweep $ACCOUNT $O/$step-$n-before.json $org $O/$step-$n-sweep.json | tee -a $LOG
      swept=${pipestatus[2]}; say "sweep exit $swept"
      zsh $HERE/staging-deploy.sh --checkout $W 2>&1 | filter | tail -6 | tee -a $LOG
      restored=${pipestatus[1]}
      # Which org staging serves now: curl's configuration (the token) through a pipe, never an argument or a file, and
      # no ~/.curlrc (-q, first), whose verbose or trace options would print or keep the token.
      served=$(printf 'header = "cf-access-token: %s"\nurl = "%s/api/me"\n' "$T" "$URL" | curl -q -sf --max-time 30 -K - | python3 -B -I -c 'import json,sys; print(json.load(sys.stdin)["org"]["id"])' 2>/dev/null)
      unset T
      say "restore exit $restored; staging serves org: ${served:-unknown}; log $LOG"
      [[ -n $served ]] || say "restore check failed: /api/me gave no org within 30 s (no answer, an error status or an unreadable body)"
      if (( first == 0 && deployed == 0 && ${#checks} > 0 && ${#${checks:#0}} == 0 && swept == 0 && restored == 0 )) && [[ $served == "$STAGING_ORG" ]]; then final=0; else final=$(( first ? first : 1 )); fi
      exit $final
    }
    trap finalize EXIT
    trap 'exit 130' INT TERM
    zsh $HERE/staging-deploy.sh --checkout $W --org-id $org --org-name "throwaway $n" 2>&1 | filter | tail -6 | tee -a $LOG
    deployed=${pipestatus[1]}
    if (( deployed != 0 )); then
      say "the throwaway deploy failed (exit $deployed): no checks; sweeping and restoring"
    elif [[ $step == throwaway ]]; then
      printf 'DESK_ACCESS_TOKEN=%s\n' "$T" | deployment fake-check --test-org $org 2>&1 | filter | tee -a $LOG
      checks+=(${pipestatus[2]}); say "fake-check exit ${checks[-1]}"
      { printf 'DESK_ACCESS_TOKEN=%s\n' "$T"; printf 'CF_ACCESS_SETUP_TOKEN=%s\n' "$(cat $S/CF_ACCESS_SETUP_TOKEN)"; printf 'CF_DESK_HUB_SERVICE_TOKENS=%s\n' "$(cat $S/CF_DESK_HUB_SERVICE_TOKENS)"; } \
        | deployment redeploy-check --test-org $org --org-name "throwaway $n" \
            --assets $W/apps/desk-web/dist --web "$(git -C $W rev-parse --abbrev-ref HEAD).$(git -C $W rev-parse --short=8 HEAD)" "$@" 2>&1 | filter | tee -a $LOG
      checks+=(${pipestatus[2]}); say "redeploy-check exit ${checks[-1]}"
    else
      # Acceptance 8's desk-web check (apps/desk-web/e2e-staging): Playwright's headless Chromium, the token its
      # cookie; no trace, video, HAR or failure context. It runs in an environment of this script's choosing (no
      # PWDEBUG, PW_* or PLAYWRIGHT_* passes through), and its configuration refuses any option or such variable as
      # well. Afterwards every file it wrote is searched for the token and for what the check listed in $SCAN (the
      # enrollment code, its token, the org key), the patterns read from a pipe, never an argument: none may hold one.
      shots=$O/desk-web-$n; mkdir -p $shots
      ( cd $W/apps/desk-web && env -i HOME=$HOME PATH=$PATH USER=$USER TMPDIR=${TMPDIR:-/tmp} LANG=${LANG:-C} DESK_STAGING_TEST_ORG=$org DESK_STAGING_SHOTS=$shots DESK_STAGING_SCAN=$SCAN npx playwright test -c playwright.staging.config.ts ) 2>&1 | filter | tee -a $LOG
      checks+=(${pipestatus[1]}); say "desk-web check exit ${checks[-1]}; screenshots: $(cd $shots && print -r -- *.png(N))"
      holding=$(/usr/bin/grep -rlF -f <(print -r -- "$T"; /usr/bin/grep -v '^$' $SCAN) $shots $LOG 2>/dev/null | wc -l | tr -d ' ')
      say "files holding the Access token or the enrollment code: $holding"
      (( holding == 0 )) || checks+=(1)
    fi
    exit 0 ;;
  *) print -r -- "prod <label> | deploy | build | acceptance [--no-push] | relay-measure | access-sync | admin <args…> | throwaway <n> | desk-web <n>"; exit 2 ;;
esac
