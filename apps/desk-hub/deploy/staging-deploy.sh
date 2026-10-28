#!/bin/zsh
# Deploys the STAGING hub (the Worker desk-hub-staging, deploy/staging.json) from a clean MAWS checkout: the desk-web
# build, then `deployment deploy --config deploy/staging.json`. The two Cloudflare tokens are read from files inside this
# script, at run time, and never printed. Every wrangler call the tool makes prints the target it checked ("wrangler
# target …"); the run fails if any names a Worker other than desk-hub-staging. Production (the Worker desk-hub, its host)
# is refused by name before anything runs.
#
# Usage: zsh apps/desk-hub/deploy/staging-deploy.sh [--checkout <MAWS checkout>] [--org-id staging-<…>] [--org-name <name>]
#   --checkout   the checkout to deploy (default: the one this script is in); it must be the top of a git worktree and
#                clean (tracked files; untracked ones are not deployed)
#   --org-id     a throwaway org for the proofs, staging-<lowercase letters, digits, -> (default: staging.json's)
#   --org-name   its name
# Only these options are forwarded, and only checked values: nothing passed here can name another config or Worker.
# Environment (README "Staging runs"): DESK_STAGING_SECRETS, the directory holding CF_ACCESS_SETUP_TOKEN and
# CF_DESK_HUB_SERVICE_TOKENS; DESK_STAGING_DIR, where the log goes; DESK_HEAVY_WRAPPER, a command prefix for the web
# build (a slot limiter, say).
readonly STAGING_WORKER=desk-hub-staging
readonly STAGING_HOST=desk-hub-staging.opencognita-platform.workers.dev
readonly STAGING_ORG=staging-ssfskim
readonly PRODUCTION_WORKER=desk-hub
readonly PRODUCTION_HOST=desk-hub.opencognita-platform.workers.dev
S=${DESK_STAGING_SECRETS:-$HOME/.config/claude-secrets/projects/-Users-new-Developer-GitHub-doperpowers}
OUT=${DESK_STAGING_DIR:-$HOME/.local/state/desk-hub-staging}
D=${0:A:h:h:h:h}
extra=()
while (( $# )); do
  case $1 in
    --checkout)
      [[ -n $2 && $2 != -* ]] || { print -r -- "--checkout needs a path: stop"; exit 2; }
      D=${2:A}; shift 2 ;;
    --org-id)
      [[ $2 =~ '^staging-[a-z0-9][a-z0-9-]{0,40}$' ]] || { print -r -- "--org-id must be staging-<lowercase letters, digits, ->: stop"; exit 2; }
      extra+=(--org-id $2); shift 2 ;;
    --org-name)
      [[ -n $2 && $2 != -* ]] || { print -r -- "--org-name needs a value: stop"; exit 2; }
      extra+=(--org-name $2); shift 2 ;;
    *) print -r -- "unknown option $1 (only --checkout, --org-id and --org-name): stop"; exit 2 ;;
  esac
done
C=$D/apps/desk-hub/deploy/staging.json
# Before anything else: the config is staging's by its own words, and production's by none of them.
python3 -B -I -c '
import json, sys
c = json.load(open(sys.argv[1]))
worker, host, org = c["worker"], c["host"], c["org"]["id"]
label = host.split(".")[0]
if worker == sys.argv[5] or host == sys.argv[6] or label == sys.argv[5] or label.endswith("-" + sys.argv[5]):  # a preview alias too
    sys.exit(f"{sys.argv[1]} names production ({worker}, {host}): refusing")
if (worker, host, org) != tuple(sys.argv[2:5]):
    sys.exit(f"{sys.argv[1]} is not staging ({worker}, {host}, {org})")
' $C $STAGING_WORKER $STAGING_HOST $STAGING_ORG $PRODUCTION_WORKER $PRODUCTION_HOST || { print -r -- "stop: nothing was deployed"; exit 4; }
[[ $(git -C $D rev-parse --show-toplevel 2>/dev/null) == "${D:A}" ]] || { print -r -- "$D is not the top of a git worktree: stop"; exit 2; }
[[ -z "$(git -C $D status --porcelain --untracked-files=no)" ]] || { print -r -- "$D has uncommitted changes: stop"; exit 3; }
[[ -r $S/CF_ACCESS_SETUP_TOKEN && -r $S/CF_DESK_HUB_SERVICE_TOKENS ]] || { print -r -- "the two tokens are not readable in $S (DESK_STAGING_SECRETS): stop"; exit 2; }
umask 077
mkdir -p $OUT || exit 2
LOG=$OUT/staging-deploy-$(date -u +%Y%m%dT%H%M%SZ).log
cd $D || exit 2
# The web label, which the build carries (the phone's channel handshake names it, `h1.build`) and the deploy stamps.
L=$(git rev-parse --abbrev-ref HEAD).$(git rev-parse --short=8 HEAD)
VITE_DESK_WEB_BUILD=$L ${=DESK_HEAVY_WRAPPER} pnpm --filter desk-web build 2>&1 | tail -3
(( ${pipestatus[1]} == 0 )) || { print -r -- "the web build failed: stop"; exit 5; }
[[ -f $D/apps/desk-web/dist/index.html ]] || { print -r -- "no web build: stop"; exit 5; }
build() { curl -q -sI --max-time 30 -X POST https://$1/machine/enroll | /usr/bin/grep -i '^x-desk-build:' | tr -d '\r'; }
print -r -- "deploying staging hub@$(git rev-parse --short=8 HEAD) web@$L" | tee $LOG
print -r -- "production before: $(build $PRODUCTION_HOST)" | tee -a $LOG
printf '%s\n' "CF_ACCESS_SETUP_TOKEN=$(cat $S/CF_ACCESS_SETUP_TOKEN)" "CF_DESK_HUB_SERVICE_TOKENS=$(cat $S/CF_DESK_HUB_SERVICE_TOKENS)" \
  | pnpm --filter desk-hub deployment deploy --config deploy/staging.json --assets "$D/apps/desk-web/dist" --web $L "${extra[@]}" 2>&1 \
  | perl -ne 'print if /^wrangler target / || !/token|secret|bearer|eyJ/i' | tee -a $LOG | tail -30
rc=${pipestatus[2]}
print -r -- "deploy exit $rc" | tee -a $LOG
# Every wrangler call named desk-hub-staging, and there was at least one.
targets=$(/usr/bin/grep -c '^wrangler target ' $LOG)
others=$(/usr/bin/grep '^wrangler target ' $LOG | /usr/bin/grep -v -c "^wrangler target $STAGING_WORKER (config worker $STAGING_WORKER, ")
print -r -- "wrangler calls: $targets, naming another Worker: $others" | tee -a $LOG
sleep 5
print -r -- "staging: $(build $STAGING_HOST)" | tee -a $LOG
print -r -- "production after: $(build $PRODUCTION_HOST)" | tee -a $LOG
print -r -- "log: $LOG"
(( rc == 0 && targets > 0 && others == 0 )) || exit 1
