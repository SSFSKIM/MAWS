#!/bin/zsh
# Deploys PRODUCTION (the Worker desk-hub, deploy/config.json) from a clean checkout of origin/master: the desk-web
# build, then `deployment deploy --config deploy/config.json`. The owner runs it, never an agent (P5 Decision Log 40;
# O13's Constraints). It is staging-deploy.sh's mechanism aimed the other way: the checkout's config.json must name
# exactly production's Worker, host and org, and a staging name or a preview alias is refused as not production, before
# anything else runs; the two Cloudflare tokens are read from files inside this script, at run time, and never printed;
# output is filtered; every wrangler call must name desk-hub. It deploys only the commit the owner names: `--confirm`
# must equal the checkout's HEAD, so a command copied from a note cannot deploy another commit.
#
# Usage: zsh apps/desk-hub/deploy/production-deploy.sh --checkout <path> --confirm <sha8> [--allow-head] [--dry-run]
#   --checkout     the checkout to deploy (default: the one this script is in; `production-run.sh checkout` makes one);
#                  the top of a git worktree, with no uncommitted changes to tracked files
#   --confirm      the checkout's HEAD as `git rev-parse --short=8 HEAD` prints it
#   --allow-head   deploy a HEAD that is not origin/master's (a hotfix), still named by --confirm
#   --dry-run      check everything, print what would run, run none of it
# Environment (README "Production runs"): DESK_PRODUCTION_SECRETS, the directory holding CF_ACCESS_SETUP_TOKEN and
# CF_DESK_HUB_SERVICE_TOKENS; DESK_PRODUCTION_DIR, where the log goes; DESK_HEAVY_WRAPPER, a command prefix for the web
# build (a slot limiter, say).
readonly PRODUCTION_WORKER=desk-hub
readonly PRODUCTION_HOST=desk-hub.opencognita-platform.workers.dev
readonly PRODUCTION_ORG=ssfskim
readonly STAGING_WORKER=desk-hub-staging
readonly STAGING_HOST=desk-hub-staging.opencognita-platform.workers.dev
S=${DESK_PRODUCTION_SECRETS:-$HOME/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers}
OUT=${DESK_PRODUCTION_DIR:-$HOME/.local/state/desk-hub-production}
D=${0:A:h:h:h:h}
confirm= allow_head=0 dry=0
while (( $# )); do
  case $1 in
    --checkout)
      [[ -n $2 && $2 != -* ]] || { print -r -- "--checkout needs a path: stop"; exit 2; }
      D=${2:A}; shift 2 ;;
    --confirm)
      [[ $2 =~ '^[0-9a-f]{8,40}$' ]] || { print -r -- "--confirm needs the commit, as 'git rev-parse --short=8 HEAD' prints it: stop"; exit 2; }
      confirm=$2; shift 2 ;;
    --allow-head) allow_head=1; shift ;;
    --dry-run) dry=1; shift ;;
    *) print -r -- "unknown option $1 (only --checkout, --confirm, --allow-head and --dry-run): stop"; exit 2 ;;
  esac
done
C=$D/apps/desk-hub/deploy/config.json
# Before anything else: the config is production's by its own words, and staging's or a preview alias's by none.
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
' $C $PRODUCTION_WORKER $PRODUCTION_HOST $PRODUCTION_ORG $STAGING_WORKER $STAGING_HOST || { print -r -- "stop: nothing was deployed"; exit 4; }
[[ -n $confirm ]] || { print -r -- "--confirm <sha8> is required: the checkout's HEAD, as 'git -C $D rev-parse --short=8 HEAD' prints it. Nothing was deployed."; exit 2; }
[[ $(git -C $D rev-parse --show-toplevel 2>/dev/null) == "${D:A}" ]] || { print -r -- "$D is not the top of a git worktree: stop"; exit 2; }
# The checkout's lock, which production-run.sh's checkout takes too: nothing updates the worktree while this deploys.
# Never taken over: a lock left by a run that died is removed by hand, once no run is going.
LOCK=$(git -C $D rev-parse --absolute-git-dir)/desk-production.lock
mkdir $LOCK 2>/dev/null || { print -r -- "$D is held by another production run ($(cat $LOCK/holder 2>/dev/null)): stop. If none is running, remove $LOCK. Nothing was deployed."; LOCK=; exit 6; }
trap '[[ -n $LOCK ]] && rm -rf $LOCK' EXIT
trap 'exit 130' INT TERM
print -r -- "production-deploy.sh, pid $$ on $(hostname), since $(date -u +%FT%TZ)" > $LOCK/holder
[[ -z "$(git -C $D status --porcelain --untracked-files=no)" ]] || { print -r -- "$D has uncommitted changes: stop. Nothing was deployed."; exit 3; }
head=$(git -C $D rev-parse --short=8 HEAD) full=$(git -C $D rev-parse HEAD)
[[ $confirm == $head ]] || { print -r -- "--confirm $confirm is not $D's HEAD ($head): stop. Nothing was deployed."; exit 3; }
git -C $D fetch -q origin master || { print -r -- "could not fetch origin's master into $D: stop"; exit 2; }
if [[ $full == $(git -C $D rev-parse -q --verify refs/remotes/origin/master) ]]; then
  at="at origin/master $head"; label=master.$head
elif (( allow_head )); then
  at="at $head, not origin/master (--allow-head)"; label=head.$head
else
  print -r -- "HEAD $head is not origin/master ($(git -C $D rev-parse --short=8 refs/remotes/origin/master 2>/dev/null)): stop. Deploy master's head, or pass --allow-head to deploy this commit. Nothing was deployed."
  exit 3
fi
[[ -r $S/CF_ACCESS_SETUP_TOKEN && -r $S/CF_DESK_HUB_SERVICE_TOKENS ]] || { print -r -- "the two tokens are not readable in $S (DESK_PRODUCTION_SECRETS): stop. Nothing was deployed."; exit 2; }
ASSETS=$D/apps/desk-web/dist
DEPLOY=(deployment deploy --config deploy/config.json --assets $ASSETS --web $label)
print -r -- "config: $PRODUCTION_WORKER (production); checkout $D clean $at"
if (( dry )); then
  print -r -- "would run: VITE_DESK_WEB_BUILD=$label ${DESK_HEAVY_WRAPPER:+$DESK_HEAVY_WRAPPER }pnpm --filter desk-web build"
  print -r -- "would run: $DEPLOY (CF_ACCESS_SETUP_TOKEN and CF_DESK_HUB_SERVICE_TOKENS on its stdin, from DESK_PRODUCTION_SECRETS)"
  print -r -- "would wait: up to 2 minutes for https://$PRODUCTION_HOST to carry hub@$head"
  print -r -- "dry run: nothing was run"
  exit 0
fi
umask 077
mkdir -p $OUT || exit 2
LOG=$OUT/production-deploy-$(date -u +%Y%m%dT%H%M%SZ).log
cd $D || exit 2
# Production's X-Desk-Build, credential-free, within $1 seconds (default 30).
build() { curl -q -sI --max-time ${1:-30} -X POST https://$PRODUCTION_HOST/machine/enroll | /usr/bin/grep -i '^x-desk-build:' | tr -d '\r'; }
print -r -- "deploying production hub@$head web@$label ($at)" | tee $LOG
print -r -- "production before: $(build)" | tee -a $LOG
# The label the phone's handshake carries as its build (O13 M4), baked into the web build.
VITE_DESK_WEB_BUILD=$label ${=DESK_HEAVY_WRAPPER} pnpm --filter desk-web build 2>&1 | tail -3
(( ${pipestatus[1]} == 0 )) || { print -r -- "the web build failed: stop. Nothing was deployed." | tee -a $LOG; exit 5; }
[[ -f $ASSETS/index.html ]] || { print -r -- "no web build at $ASSETS: stop. Nothing was deployed." | tee -a $LOG; exit 5; }
# The build may have waited (DESK_HEAVY_WRAPPER), and deploy.ts stamps the HEAD it finds when it runs: before the tokens
# are handed over, the checkout must still be the confirmed commit with no uncommitted changes to tracked files, which
# config.json is, so the config checked above is still the one deployed.
[[ $(git -C $D rev-parse HEAD) == $full && -z "$(git -C $D status --porcelain --untracked-files=no)" ]] \
  || { print -r -- "$D moved during the build (HEAD $(git -C $D rev-parse --short=8 HEAD), confirmed $head, or uncommitted changes): stop. Nothing was deployed." | tee -a $LOG; exit 3; }
printf '%s\n' "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)" "CF_DESK_HUB_SERVICE_TOKENS=$(cat $S/CF_DESK_HUB_SERVICE_TOKENS)" \
  | pnpm --filter desk-hub $DEPLOY 2>&1 \
  | perl -ne 'print if /^wrangler target / || !/token|secret|bearer|eyJ/i' | tee -a $LOG | tail -30
rc=${pipestatus[2]}
print -r -- "deploy exit $rc" | tee -a $LOG
# Every wrangler call named desk-hub, and there was at least one.
targets=$(/usr/bin/grep -c '^wrangler target ' $LOG)
others=$(/usr/bin/grep '^wrangler target ' $LOG | /usr/bin/grep -v -c "^wrangler target $PRODUCTION_WORKER (config worker $PRODUCTION_WORKER, ")
print -r -- "wrangler calls: $targets, naming another Worker: $others" | tee -a $LOG
if (( rc != 0 || targets == 0 || others != 0 )); then print -r -- "log: $LOG"; exit 1; fi
# The deploy is done when production answers with this commit's hub (not one stamped +dirty), within 2 minutes of
# elapsed time: each read and each pause is cut to what is left of them.
deadline=$(( $(date +%s) + 120 ))
while left=$(( deadline - $(date +%s) )); (( left > 0 )); do
  b=$(build $(( left < 30 ? left : 30 )))
  print -r -- "$(date -u +%H:%M:%SZ) $b" | tee -a $LOG
  if [[ $b =~ "hub@$head( |\$)" ]]; then print -r -- "production carries hub@$head" | tee -a $LOG; print -r -- "log: $LOG"; exit 0; fi
  left=$(( deadline - $(date +%s) ))
  (( left > 0 )) && sleep $(( left < 10 ? left : 10 ))
done
print -r -- "production never carried hub@$head within 2 minutes: check it with 'production-run.sh build'" | tee -a $LOG
print -r -- "log: $LOG"
exit 1
