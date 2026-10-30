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
#                            behind an account-less quick tunnel (start_tunnel: cloudflared tunnel --url, then the
#                            quick-tunnel API asked directly), unless --no-push
#   relay-measure            `deployment relay-measure` under staging-ssfskim
#   access-sync              `deployment access-sync`: the people policy read back at the org state's head
#   admin <args…>            `deployment admin <args…>` against staging-ssfskim with the admin device's keys: adopt,
#                            devices, refresh, show run unattended; every verb that signs, posts or deletes confirms at
#                            /dev/tty, and a pairing or enrollment code goes to the terminal alone, never to the log
#   admin --pipe <verb…>     the secret-stream mode, for delegation create and code strip-legacy alone: the token in the
#                            command's environment, its stdin and stdout untouched and unlogged, its stderr alone
#                            filtered and logged; refused when stdout is a terminal (production-run.sh's, the same);
#                            delegation create posts no state; admin delegation publish alone posts its proposal
#   throwaway <n>            staging deployed under the throwaway org staging-probe-<n>, fake-check and redeploy-check
#                            there, the account swept (staging-sweep.py), staging restored under staging-ssfskim
#   desk-web <n>             the same around acceptance 8's desk-web check (apps/desk-web/e2e-staging) in place of
#                            the two commands: screenshots into desk-web-<n>/
#   phone <n> [--rehearse] [--lane-b] [--device <id>]
#                            P5 O13 M7: test/endpoint/staging-phone.live.test.ts, MAWS's endpoint module enrolled as
#                            o13-phone-<n>, the owner's cards answered from the phone (--rehearse: by the run's second
#                            device in its place); the push sink behind a quick tunnel (start_tunnel); the run's undoing
#                            run again after it, however it ended; production's X-Desk-Build compared before and after
#   endpoint [args…]         P5 O10 M11: `deployment endpoint-acceptance`, the scratch mawsd on the devcloud acceptance
#                            VM enrolled and listed, items 2-5, 8 and 9 over the relay and the tailnet, the hub deploy
#                            this script's own `deploy`; production's X-Desk-Build compared before and after
#   endpoint-vm setup <base> | teardown
#                            that VM's scene set up (the branch built there from a bundle cut at <base>) or removed
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
# A line naming a token, a secret or a bearer (any case), or holding a JWT (its prefix `eyJ`, base64url of `{"`, whose case
# is its own: read case-insensitively it dropped any line holding `eyj`, a base32 launch id among them), is not passed on.
filter() { perl -ne 'BEGIN { $| = 1 } print if /^wrangler target / || !(/token|secret|bearer/i || /eyJ/)'; }
# How many of `paths…` hold any line of the list file <list> (empty lines ignored, so an empty list matches nothing):
# the search after a run for the secrets it handled. The patterns are read from the list, never an argument.
secret_scan() {
  local list=$1; shift
  /usr/bin/grep -rlF -f <(/usr/bin/grep -v '^$' $list) "$@" 2>/dev/null | wc -l | tr -d ' '
}
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
deployment() { local c=$1; shift; pnpm -s -C $W --filter desk-hub deployment $c --config deploy/staging.json "$@"; }
# The same command for the secret-stream mode, launched as the package's `deployment` script launches it but not through
# pnpm, whose recursive runner writes its own failure lines (ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL, the checkout's path) to
# stdout even under -s: there stdout is the secret stream, and holds the command's own output alone.
direct() { local c=$1; shift; ( cd $W/apps/desk-hub && node --experimental-strip-types --disable-warning=ExperimentalWarning deploy/bin.ts $c --config deploy/staging.json "$@" ); }
# ---- The push sink's tunnel (acceptance's item 5, phone's push clause): account-less, P5 Decision Log 39 ------------
# TUNNEL holds its cloudflared's pid, PUBLIC its https base, TCREDS the credentials file it runs on (the API's way);
# each attempt is told through the step's `say`.
TUNNEL= PUBLIC= TCREDS=
# Whether the cloudflared at TUNNEL, logging to <log>, registered within 45 s; PUBLIC is <public>, or read from the log.
tunnel_up() {
  local tl=$1 i
  PUBLIC=$2
  for i in {1..45}; do
    [[ -n $2 ]] || PUBLIC=$(/usr/bin/grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' $tl | /usr/bin/grep -v '^https://api\.' | head -1)
    [[ -n $PUBLIC ]] && /usr/bin/grep -q 'Registered tunnel connection' $tl && kill -0 $TUNNEL 2>/dev/null && return 0
    kill -0 $TUNNEL 2>/dev/null || break
    sleep 1
  done
  PUBLIC=
  return 1
}
# A quick tunnel to 127.0.0.1:<port>: `cloudflared tunnel --url` three times, 5 s apart; then cloudflared's own request
# for one made here, waiting 60 s for the quick-tunnel API where cloudflared waits 15 s (it has taken 22-33 s to answer:
# the friction tracker's quick-tunnel-api-slower-than-cloudflared-timeout), and cloudflared run on the credentials it
# answered, written to <creds> (0600, removed by stop_tunnel) and, when <scan> is given, their secret listed there for
# the run's search; never printed. 1 when no tunnel came up.
start_tunnel() {
  local port=$1 tag=$2 creds=$3 scan=$4 try tl named
  # An earlier run's credentials under the same name (one killed outright, or a crash) go first, whichever way this one
  # comes up.
  rm -f $creds
  for try in 1 2 3; do
    tl=$O/tunnel-$tag-$(stamp)-$try.log
    cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$port > $tl 2>&1 &
    TUNNEL=$!
    if tunnel_up $tl; then say "push sink: $PUBLIC -> 127.0.0.1:$port (try $try)"; return 0; fi
    say "the quick tunnel did not come up (try $try): $(/usr/bin/grep -iE 'fail|error' $tl | head -1)"
    stop_tunnel
    (( try < 3 )) && sleep 5
  done
  TCREDS=$creds
  named=$(curl -q -s --max-time 60 -X POST -H 'Content-Type: application/json' https://api.trycloudflare.com/tunnel < /dev/null | python3 -B -I -c '
import json, os, re, sys
try:
    r = json.load(sys.stdin)["result"]
    id, host, secret = r["id"], r["hostname"], r["secret"]
    creds = {"AccountTag": r["account_tag"], "TunnelSecret": secret, "TunnelID": id}
except Exception:
    sys.exit("its answer named no tunnel")
if not (isinstance(secret, str) and secret and re.fullmatch(r"[0-9a-f-]{36}", id) and re.fullmatch(r"[a-z0-9-]+\.trycloudflare\.com", host)):
    sys.exit("its answer named no tunnel of the form expected")
with os.fdopen(os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
    json.dump(creds, f)
if sys.argv[2]:
    with open(sys.argv[2], "a") as f:
        f.write(secret + "\n")
print(id, host)
' $creds "$scan" 2>&1) || { say "the quick-tunnel API gave no tunnel: ${named:-no answer within 60 s}"; stop_tunnel; return 1; }
  tl=$O/tunnel-$tag-$(stamp)-api.log
  cloudflared tunnel --no-autoupdate --credentials-file $creds --url http://127.0.0.1:$port run ${named%% *} > $tl 2>&1 &
  TUNNEL=$!
  if tunnel_up $tl https://${named#* }; then say "push sink: $PUBLIC -> 127.0.0.1:$port (through the quick-tunnel API)"; return 0; fi
  say "the tunnel the quick-tunnel API named did not come up: $(/usr/bin/grep -iE 'fail|error' $tl | head -1)"
  stop_tunnel
  return 1
}
# The tunnel stopped and its credentials removed; nothing when there is neither.
stop_tunnel() {
  [[ -n $TCREDS ]] && { rm -f $TCREDS; TCREDS=; }
  [[ -z $TUNNEL ]] && return
  local gone
  kill $TUNNEL 2>/dev/null; wait $TUNNEL 2>/dev/null
  kill -0 $TUNNEL 2>/dev/null && gone="STILL RUNNING" || gone="process gone"
  say "tunnel stopped: pid $TUNNEL at $(date -u +%FT%TZ), $gone"
  TUNNEL=
}
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
    say() { print -r -- "$*" | tee -a $LOG; }
    if (( ! nopush )); then
      PORT=18743
      trap stop_tunnel EXIT
      trap 'exit 130' INT TERM
      start_tunnel $PORT acceptance $O/acceptance-tunnel.json '' || { say "no tunnel for the push sink by $(date -u +%FT%TZ): stop"; exit 2; }
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
    pipe=0
    [[ $1 == --pipe ]] && { pipe=1; shift; }
    # In the secret-stream mode stdout is the code's pipe: every line of the runner's own goes to stderr.
    say() { if (( pipe )); then print -r -- "$*" >&2; else print -r -- "$*"; fi; }
    sub=$1
    verb="$1${2:+ $2}"
    if (( pipe )); then
      [[ $verb == ("delegation create"|"code strip-legacy") ]] || { say "admin --pipe is for delegation create and code strip-legacy alone, the verbs whose stdout is a secret code (given: ${verb:-nothing}): stop. Nothing was changed."; exit 2; }
      [[ -t 1 ]] && { say "admin --pipe: stdout is a terminal, and the code goes only to a pipe: stop. Nothing was changed."; exit 2; }
    else
      [[ $verb == "delegation create" || $sub == code ]] && { say "admin $verb writes a secret code to stdout, which this step filters and logs: run it as 'staging-run.sh admin --pipe $verb … | <its destination>': stop. Nothing was changed."; exit 2; }
    fi
    [[ $verb == "code strip-legacy" || -f $H/keys.json ]] || { say "no admin device keys at $H/keys.json (DESK_STAGING_DEVICE): stop"; exit 2; }
    # The step names the deployment and the keys itself; staging's admin device is O11's test device, adopted, not made.
    [[ $1 == init ]] && { say "admin init: staging's admin device exists ($H/keys.json); run admin adopt: stop. Nothing was changed."; exit 2; }
    for a in "$@"; do
      [[ $a == (--hub|--user|--yes|--config|--keys)(|=*) ]] && { say "admin takes no $a here: the step acts on staging with $H/keys.json, confirming at /dev/tty: stop. Nothing was changed."; exit 2; }
    done
    if (( pipe )); then
      # As production-run.sh's: the token in the environment alone, stdout to the pipe, stderr alone filtered and logged.
      unsetopt multios
      LOG=$O/admin-${sub}-pipe-$(stamp).log
      if [[ $sub == code ]]; then
        { direct admin "$@" 2>&1 1>&3 3>&- | filter | tee -a $LOG >&2; rc=${pipestatus[1]}; } 3>&1
      else
        owner_token >&2
        { DESK_ACCESS_TOKEN=$T direct admin --keys $H/keys.json "$@" 2>&1 1>&3 3>&- | filter | tee -a $LOG >&2; rc=${pipestatus[1]}; } 3>&1
        unset T
      fi
      say "admin exit $rc; log $LOG (stderr alone: stdout went to the pipe)"; exit $rc
    fi
    owner_token
    LOG=$O/admin-$(stamp).log
    printf 'DESK_ACCESS_TOKEN=%s\n' "$T" | deployment admin --keys $H/keys.json "$@" 2>&1 | filter | tee -a $LOG
    rc=${pipestatus[2]}; unset T
    print -r -- "admin exit $rc; log $LOG"; exit $rc ;;
  endpoint)
    # P5 O10 M11: `deployment endpoint-acceptance`, the scratch mawsd on the devcloud acceptance VM (its scene set up by
    # `endpoint-vm setup`) enrolled and listed by the admin device, the items run over the relay and the tailnet, its hub
    # deploy item this script's own `deploy` step; then everything it made undone by the run itself. The token reaches
    # the command on its stdin alone; what else it handled (the enrollment code and its secrets) is listed in $SCAN for
    # the search after it; production's X-Desk-Build compared before and after (its build alone).
    [[ -f $H/keys.json ]] || { print -r -- "no admin device keys at $H/keys.json (DESK_STAGING_DEVICE): stop. Nothing was changed."; exit 2; }
    LOG=$O/endpoint-$(stamp).log; : > $LOG
    SCAN=$O/endpoint.scan; : > $SCAN
    say() { print -r -- "$*" | tee -a $LOG; }
    owner_token
    before=$(header $PROD) || exit 3
    say "production before: $before"
    ran=1 finished=0
    finish() {
      (( finished )) && return; finished=1
      after=$(header $PROD) || after="unread"
      # Production's build header is what this compares, and all it can vouch for: the run's own guards keep it off
      # production (endpoint-acceptance refuses it by name).
      if [[ $after == "$before" ]]; then say "production build unchanged: $after"; else say "production build CHANGED or unread: $after"; fi
      leaked=$(secret_scan <(print -r -- "$T"; cat $SCAN) $LOG)
      unset T
      rm -f $SCAN
      say "files holding the Access token or a secret the run handled: $leaked; log $LOG"
      (( ran == 0 && leaked == 0 )) && [[ $after == "$before" ]] && exit 0
      exit $(( ran ? ran : 1 ))
    }
    trap finish EXIT
    trap 'exit 130' INT TERM
    printf 'DESK_ACCESS_TOKEN=%s\n' "$T" | deployment endpoint-acceptance --device-keys $H/keys.json --scan $SCAN --hub-deploy $HERE/staging-run.sh "$@" 2>&1 | filter | tee -a $LOG
    ran=${pipestatus[2]}
    say "endpoint acceptance exit $ran"
    exit $ran ;;
  endpoint-vm)
    # P5 O10 M11: the VM scene's setup (vm/setup.sh: the scratch user, the scene's files, the branch built from a bundle
    # cut at <base>, a commit the VM's MAWS checkout holds) or teardown (vm/teardown.sh), through `devcloud vm ssh`
    # alone. No token is read: neither touches the hub.
    case ${1:-} in
      setup) [[ ${2:-} =~ '^[0-9a-f]{7,40}$' ]] || { print -r -- "endpoint-vm setup <base commit> | teardown"; exit 2; }
        deployment endpoint-acceptance --vm-setup --base $2 < /dev/null 2>&1 | filter ;;
      teardown) deployment endpoint-acceptance --vm-teardown < /dev/null 2>&1 | filter ;;
      *) print -r -- "endpoint-vm setup <base commit> | teardown"; exit 2 ;;
    esac
    exit ${pipestatus[1]} ;;
  phone)
    # P5 O13 M7 (Interfaces §H): test/endpoint/staging-phone.live.test.ts, the real endpoint module enrolled on staging as
    # o13-phone-<n>, the owner's cards raised there and answered from the phone (or, --rehearse, by the run's second
    # device in its place), then everything it made undone. The step's own cleanup pass runs however the run ends.
    n=${1:?a run id}; shift
    [[ $n =~ '^[a-z0-9-]{1,20}$' ]] || { print -r -- "bad run id $n"; exit 2; }
    mode=phone laneb=probe device=
    while (( $# )); do
      case $1 in
        --rehearse) mode=rehearse ;;
        --lane-b) laneb=required ;;
        --device) [[ $2 =~ '^[A-Za-z0-9_-]{1,64}$' ]] || { print -r -- "--device <the phone's device id>: stop. Nothing was changed."; exit 2; }; device=$2; shift ;;
        *) print -r -- "phone takes --rehearse, --lane-b and --device <id> (given: $1): stop. Nothing was changed."; exit 2 ;;
      esac
      shift
    done
    [[ -f $H/keys.json && -f $H/keys.json.org.json ]] || { print -r -- "no admin device keys and anchor at $H/keys.json(.org.json) (DESK_STAGING_DEVICE; admin adopt writes the anchor): stop. Nothing was changed."; exit 2; }
    LOG=$O/phone-$n-$(stamp).log; : > $LOG
    # What the run handled besides the token (enrollment and pairing codes, their secrets, the machine's service token),
    # one a line, for the search below; and the endpoint's scratch profile. Both removed however the step ends.
    SCAN=$O/phone-$n.scan; : > $SCAN
    PROFILE=$O/phone-$n.profile; rm -rf $PROFILE; mkdir -m 700 $PROFILE
    say() { print -r -- "$*" | tee -a $LOG; }
    owner_token
    before=$(header $PROD) || exit 3
    say "production before: $before"
    PORT=18744
    # The suite runs in a process group of its own (zsh without a terminal has no job control), its id in $PGF, so a
    # signal to this script stops all of it before the cleanup pass, instead of waiting for it to end.
    PGF=$O/phone-$n.pgid SUITE=; rm -f $PGF
    stop_suite() {
      [[ -z $SUITE ]] && return
      local pg= i
      for i in {1..25}; do [[ -s $PGF ]] && break; kill -0 $SUITE 2>/dev/null || break; sleep 0.2; done
      pg=$(<$PGF 2>/dev/null); rm -f $PGF
      if [[ $pg == <-> ]] && kill -0 -$pg 2>/dev/null; then
        kill -TERM -$pg 2>/dev/null
        for i in {1..20}; do kill -0 -$pg 2>/dev/null || break; sleep 0.5; done
        if kill -0 -$pg 2>/dev/null; then kill -KILL -$pg 2>/dev/null; say "the suite stopped: process group $pg killed, 10 s after TERM"
        else say "the suite stopped: process group $pg ended on TERM"; fi
      fi
      wait $SUITE 2>/dev/null
      SUITE=
    }
    finalized=0 ran=1
    finalize() {
      (( finalized )) && return; finalized=1
      stop_suite
      stop_tunnel
      # The run's own cleanup ran in the run; this pass finds anything a run killed outright left, and undoes it.
      DESK_ACCESS_TOKEN=$T DESK_STAGING_PHONE=cleanup DESK_STAGING_PHONE_RUN=$n DESK_STAGING_ADMIN_KEYS=$H/keys.json \
        pnpm -s -C $W exec vitest run --project node test/endpoint/staging-phone.live.test.ts 2>&1 | filter | /usr/bin/grep -E '^(cleanup|LEFT)|Error' | tee -a $LOG
      swept=${pipestatus[1]}
      (( swept == 0 )) || say "the cleanup pass failed (exit $swept): what the run made may still be current; run the step again with the same run id once the cause is fixed (it sweeps first)"
      after=$(header $PROD) || after="unread"
      if [[ $after == "$before" ]]; then say "production untouched: $after"; else say "production build CHANGED or unread: $after"; fi
      leaked=$(secret_scan <(print -r -- "$T"; cat $SCAN) $LOG $O/tunnel-$n-*.log(N))
      unset T
      rm -rf $SCAN $PROFILE $PGF
      say "files holding the Access token or a secret the run handled: $leaked; log $LOG"
      (( ran == 0 && swept == 0 && leaked == 0 )) && [[ $after == "$before" ]] && exit 0
      exit $(( ran ? ran : 1 ))
    }
    trap finalize EXIT
    trap 'exit 130' INT TERM
    # The push sink behind an account-less quick tunnel (start_tunnel); without one, the push clause is NOT SHOWN.
    if start_tunnel $PORT $n $O/phone-$n.tunnel.json $SCAN; then
      sinkenv=(DESK_STAGING_PHONE_SINK=$PUBLIC/staging-run DESK_STAGING_PHONE_SINK_PORT=$PORT)
    else
      sinkenv=(DESK_STAGING_PHONE_NO_SINK="tunnel: the quick tunnel did not come up in 3 tries, nor through the quick-tunnel API")
    fi
    say "phone run $n ($mode) on staging; the machine o13-phone-$n; log $LOG"
    [[ $mode == phone ]] && say "on the phone, have staging's desk-web open (or closed: its notifications land on the cards); the run prints WAITING when it is the phone's turn"
    # The token reaches the suite in its environment alone (a prefix assignment or the builtin export, never an argument).
    # The suite leads a process group of its own (perl's setpgrp, then exec), its id written to $PGF; the pipeline runs
    # in the background and is waited for, so INT and TERM reach their trap at once (stop_suite, then the cleanup pass).
    { ( export "${sinkenv[@]}"
        DESK_ACCESS_TOKEN=$T DESK_STAGING_PHONE=1 DESK_STAGING_PHONE_RUN=$n DESK_STAGING_PHONE_MODE=$mode DESK_STAGING_PHONE_LANE_B=$laneb \
          DESK_STAGING_PHONE_DEVICE=$device DESK_STAGING_ADMIN_KEYS=$H/keys.json DESK_STAGING_PHONE_SCAN=$SCAN DESK_STAGING_PHONE_PROFILE=$PROFILE \
          exec /usr/bin/perl -e 'setpgrp(0, 0) or die "setpgrp: $!"; open(my $f, ">", shift) or die "$!"; print $f "$$"; close $f; exec { $ARGV[0] } @ARGV or die "exec: $!"' \
          $PGF pnpm -s -C $W exec vitest run --project node test/endpoint/staging-phone.live.test.ts ) 2>&1 | filter | tee -a $LOG
      exit ${pipestatus[1]}; } &
    SUITE=$!
    wait $SUITE; ran=$?
    SUITE=; rm -f $PGF
    say "phone run exit $ran"
    exit $ran ;;
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
  *) print -r -- "prod <label> | deploy | build | acceptance [--no-push] | relay-measure | access-sync | admin [--pipe] <args…> | throwaway <n> | desk-web <n> | phone <n> [--rehearse] [--lane-b] [--device <id>] | endpoint [args…] | endpoint-vm setup <base> | teardown"; exit 2 ;;
esac
