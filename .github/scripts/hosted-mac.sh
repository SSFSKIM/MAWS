#!/usr/bin/env bash
# The waiter: one hosted e2e group of a private gate run (gate.yml's e2e-hosted job; ci-kit's
# docs/doperpowers/specs/2026-10-26-maws-hosted-mac-design.md, The flow of one hosted group). It pushes the filtered tree
# of the run's commit to SSFSKIM/maws-app as a request, waits for the result commit maws-app's workflow writes when the
# group's hosted job ends, and exits with its verdict: 0 for success, 1 for anything else.
#
#   .github/scripts/hosted-mac.sh             the request, then the wait
#   .github/scripts/hosted-mac.sh --cleanup   after the job, whatever happened: cancels a request left without its
#                                             result, deletes a result ref that is there; best-effort, exits 0
#
# Everything crosses over git, with the deploy key: no API credential reaches maws-app, and git over SSH shares no rate
# limit with MAWS's other jobs. The request is a commit of the filter's output (maws-app-tree.sh, added with
# `git add -A --force`) with maws-app's main as its parent, on ci/hosted/<run id>-<attempt>-<slug>; its trailers carry
# the provenance and the plan entry. Before the push, maws-app-scan.sh scans the files the push adds (those that differ
# from main's tree) and a finding pushes nothing. The result, on ci/result/<suffix>, is a commit of the request's tree
# with the request as its only parent and `Hosted-Conclusion:` and `Hosted-Run:` trailers; one with another parent is
# ignored. A cancel is a commit pushed over a request, with a `Hosted-Cancel:` trailer: maws-app's concurrency group
# cancels the request's run, and its stale guard makes a request replaced before it starts inert. When main is a day old
# and the requested commit is on MAWS master, the request also fast-forwards main.
#
# Environment: ENTRY (the plan's e2e entry, JSON), EVIDENCE (the plan's, true or false), MAWS_APP_DEPLOY_KEY (the deploy
# key's private half), GITHUB_TOKEN (MAWS's job token, for its compare API), and the runner's GITHUB_SHA, GITHUB_RUN_ID,
# GITHUB_RUN_ATTEMPT, GITHUB_REPOSITORY, GITHUB_API_URL and RUNNER_TEMP. Run from the checkout of GITHUB_SHA. For the
# tests: MAWS_APP_REMOTE replaces maws-app's URL, MAWS_HOSTED_POLL_SECONDS the 30 s between reads of the result ref,
# MAWS_HOSTED_DEADLINE_SECONDS the 95 minutes the waiter waits.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
state=${RUNNER_TEMP:?RUNNER_TEMP is not set}/hosted-mac
APP=SSFSKIM/maws-app
POLL_SECONDS=${MAWS_HOSTED_POLL_SECONDS:-30}
# Under the job's 100-minute timeout (gate-plan.mjs), itself under the pool's 120 minutes for a box's run.
DEADLINE_SECONDS=${MAWS_HOSTED_DEADLINE_SECONDS:-$((95 * 60))}
# GitHub's published SSH host keys (api.github.com/meta, ssh_keys), for both of its SSH endpoints.
KNOWN_HOSTS=(
  'github.com,[ssh.github.com]:443 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
  'github.com,[ssh.github.com]:443 ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg='
  'github.com,[ssh.github.com]:443 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk='
)
export GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME='MAWS hosted Mac' GIT_AUTHOR_EMAIL=hosted-mac@maws-app.invalid
export GIT_COMMITTER_NAME='MAWS hosted Mac' GIT_COMMITTER_EMAIL=hosted-mac@maws-app.invalid

say() { printf 'hosted: %s\n' "$*"; }
fail() { say "$*"; exit 1; }
utc() { date -u -d "@$1" +%FT%TZ 2>/dev/null || date -u -r "$1" +%FT%TZ; }
# git in maws-app's git dir, a shallow clone of main without blobs. A missing object there would be fetched from maws-app
# on demand, and a MAWS object is not there: so MAWS's own git calls stay in the checkout, the push sends no thin pack
# (whose deltas would fetch the old blobs), and on a git that knows it, a lazy fetch is an error.
app() { GIT_NO_LAZY_FETCH=1 git --git-dir="$state/app.git" -c core.autocrlf=false -c commit.gpgSign=false "$@"; }
trailer() { git interpret-trailers --parse <<<"$1" | sed -n "s/^$2: //p" | tail -n 1; }
message_of() { app cat-file commit "$1" | sed '1,/^$/d'; }
parents_of() { app cat-file commit "$1" | sed -n '/^$/q; s/^parent //p'; }
tip_of() { # <ref>: its commit on maws-app, empty when it is not there; fails when maws-app cannot be read
  local listed
  listed=$(git ls-remote "$remote" "$1") || return 1
  printf '%s\n' "${listed%%[[:space:]]*}"
}

# The paths go into GIT_SSH_COMMAND, which git runs through a shell and whose UserKnownHostsFile OpenSSH splits on
# whitespace, so the state directory is plain (checked before anything is written there).
use_ssh() {
  export GIT_SSH_COMMAND="ssh -i $state/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$state/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=20"
}

# A commit over <request> on <ref> with a Hosted-Cancel: trailer, pushed only while <ref> is still <request>.
push_cancel() { # <ref> <request> <reason>
  local tree cancel
  tree=$(app cat-file commit "$2" | sed -n '1s/^tree //p') || return 1
  cancel=$(app commit-tree "$tree" -p "$2" -m "hosted: cancel ${1#refs/heads/}" -m "Hosted-Cancel: $3") || return 1
  app push -q --no-thin --force-with-lease="$1:$2" "$remote" "$cancel:$1" || return 1
  say "cancelled ${1#refs/heads/} ($3)"
}

# This waiter's own request, while its ref is still the request.
cancel_own() { # <reason>
  local tip
  tip=$(tip_of "refs/heads/ci/hosted/$suffix") || { say "could not read ci/hosted/$suffix to cancel it"; return 1; }
  if [[ $tip != "$request" ]]; then
    say "ci/hosted/$suffix is no longer this request (${tip:-gone}): nothing to cancel"
    return 0
  fi
  push_cancel "refs/heads/ci/hosted/$suffix" "$request" "$1" || { say "could not cancel ci/hosted/$suffix"; return 1; }
  : >"$state/cancelled"
}

cleanup() {
  set +e
  if [[ ! -f $state/request ]]; then
    rm -rf "$state"
    exit 0
  fi
  remote=$(<"$state/remote") suffix=$(<"$state/suffix") request=$(<"$state/request")
  use_ssh
  [[ -f $state/read || -f $state/cancelled ]] || cancel_own 'the private job ended without its result'
  # A cancelled run writes its result too, and the sweep takes one that comes after this.
  if [[ -n $(tip_of "refs/heads/ci/result/$suffix") ]] && app push -q "$remote" ":refs/heads/ci/result/$suffix"; then
    say "deleted ci/result/$suffix"
  fi
  rm -rf "$state"
  exit 0
}
[[ ${1:-} != --cleanup ]] || cleanup
(($# == 0)) || { echo 'usage: hosted-mac.sh [--cleanup]' >&2; exit 2; }
# A runner's temp directory is a plain path; one with a space, a quote or shell syntax would reach ssh as something else.
[[ $state =~ ^[A-Za-z0-9/._-]+$ ]] || fail "RUNNER_TEMP must be a plain path (letters, digits and / . _ -) for the deploy key's ssh command: $RUNNER_TEMP"

: "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
started=$(date +%s)
deadline=$((started + DEADLINE_SECONDS))

# The plan's entry, each value as maws-app's workflow will check it.
group=$(jq -r '.group // empty' <<<"${ENTRY:-}") || fail 'the entry is not JSON'
script=$(jq -r '.script // empty' <<<"$ENTRY")
slug=$(jq -r '.slug // empty' <<<"$ENTRY")
libreoffice=$(jq -r '.libreoffice' <<<"$ENTRY")
poppler=$(jq -r '.poppler' <<<"$ENTRY")
evidence=${EVIDENCE:-false}
[[ $group =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "the entry's group '$group' is not one maws-app takes"
[[ $script =~ ^e2e(:[a-z0-9][a-z0-9:-]*)?$ ]] || fail "the entry's script '$script' is not one maws-app takes"
[[ $slug =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "the entry's slug '$slug' is not one maws-app takes"
[[ $libreoffice == true || $libreoffice == false ]] || fail "the entry's libreoffice '$libreoffice' is not true or false"
[[ $poppler == true || $poppler == false ]] || fail "the entry's poppler '$poppler' is not true or false"
[[ $evidence == true || $evidence == false ]] || fail "EVIDENCE '$evidence' is not true or false"
[[ $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]] || fail 'GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT are not numbers'
suffix=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$slug
[[ -n ${MAWS_APP_DEPLOY_KEY:-} ]] || fail 'no deploy key: MAWS_APP_DEPLOY_KEY is empty (a run without the repository secret cannot reach maws-app)'

rm -rf "$state"
mkdir -p "$state"
chmod 700 "$state"
(umask 077 && printf '%s\n' "$MAWS_APP_DEPLOY_KEY" >"$state/key")
printf '%s\n' "${KNOWN_HOSTS[@]}" >"$state/known_hosts"
if ! command -v ssh >/dev/null; then
  say 'no ssh on this box: installing openssh-client'
  { sudo -n apt-get update -qq && sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openssh-client; } >/dev/null ||
    fail 'could not install openssh-client'
fi
use_ssh

# maws-app on port 22, else on 443.
if [[ -n ${MAWS_APP_REMOTE:-} ]]; then
  remote=$MAWS_APP_REMOTE
else
  remote=
  for candidate in "git@github.com:$APP.git" "ssh://git@ssh.github.com:443/$APP.git"; do
    if git ls-remote --exit-code "$candidate" refs/heads/main >/dev/null 2>"$state/reach.err"; then
      remote=$candidate
      break
    fi
    say "maws-app did not answer at $candidate: $(tail -n 1 "$state/reach.err")"
  done
  [[ -n $remote ]] || fail 'maws-app answers on neither port 22 nor port 443'
fi
printf '%s\n' "$remote" >"$state/remote"
printf '%s\n' "$suffix" >"$state/suffix"

# The MAWS side, in the checkout's git dir. Under ci-gate the run's commit is its nonce commit, whose tree is the requested
# commit's and whose first parent is the requested commit.
maws_git=$(git rev-parse --absolute-git-dir)
source_tree=$(git rev-parse --verify "$GITHUB_SHA^{tree}")
head_raw=$(git cat-file commit "$GITHUB_SHA")
head_message=$(sed '1,/^$/d' <<<"$head_raw")
if [[ $(head -n 1 <<<"$head_message") == 'ci-gate: '* && -n $(trailer "$head_message" Nonce) ]]; then
  requested=$(sed -n '/^$/q; s/^parent //p' <<<"$head_raw" | head -n 1)
else
  requested=$GITHUB_SHA
fi
say "e2e:$group (pnpm $script) at MAWS ${requested:0:12}, attempt $GITHUB_RUN_ATTEMPT; deadline $(utc "$deadline")"

git clone -q --bare --depth=1 --filter=blob:none --branch main --single-branch "$remote" "$state/app.git"
main_tip=$(app rev-parse --verify refs/heads/main)

# Earlier attempts of this run and group, whose waiters may be gone (a preempted box runs no cleanup).
if ((GITHUB_RUN_ATTEMPT > 1)); then
  earlier=$(git ls-remote "$remote" "refs/heads/ci/hosted/$GITHUB_RUN_ID-*") || fail "could not list the earlier attempts' requests"
  while read -r sha ref; do
    [[ $ref =~ ^refs/heads/ci/hosted/$GITHUB_RUN_ID-([0-9]+)-$slug$ ]] || continue
    k=${BASH_REMATCH[1]}
    ((k < GITHUB_RUN_ATTEMPT)) || continue
    app fetch -q --depth=1 --filter=blob:none "$remote" "$ref"
    [[ -z $(trailer "$(message_of "$sha")" Hosted-Cancel) ]] || continue
    push_cancel "$ref" "$sha" "attempt $GITHUB_RUN_ATTEMPT replaces attempt $k" || say "could not cancel ${ref#refs/heads/}"
  done <<<"$earlier"
fi

# The request's tree: the filter's output, ignored paths and all.
filter_version=$("$here/maws-app-tree.sh" "$maws_git" "$GITHUB_SHA" "$state/tree")
GIT_INDEX_FILE=$state/index app --work-tree="$state/tree" add -A --force
tree=$(GIT_INDEX_FILE=$state/index app write-tree)

# The secret scan, over what this push adds: the files whose content or kind differs from main's, which holds only trees
# scanned on their way there.
app diff-tree -r -z --no-renames --name-only --diff-filter=d "$main_tip" "$tree" >"$state/added"
mkdir "$state/scan"
python3 -I - "$state/tree" "$state/scan" "$state/added" <<'EOF'
import os, shutil, sys
src, dst, listed = (os.fsencode(arg) for arg in sys.argv[1:4])
names = [name for name in open(listed, 'rb').read().split(b'\0') if name]
for name in names:
    source, target = os.path.join(src, name), os.path.join(dst, name)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if os.path.islink(source):
        os.symlink(os.readlink(source), target)
    else:
        shutil.copyfile(source, target)
print(f'hosted: secret scan of the {len(names)} file{"" if len(names) == 1 else "s"} this push adds')
EOF
"$here/maws-app-scan.sh" "$state/scan" || fail 'secret scan refused the push'

request=$(app commit-tree "$tree" -p "$main_tip" -m "MAWS ${requested:0:12} e2e:$group" -m "MAWS-Source: $GITHUB_SHA
MAWS-Source-Tree: $source_tree
MAWS-Filter: $filter_version
MAWS-Run: $GITHUB_RUN_ID/$GITHUB_RUN_ATTEMPT
Hosted-Group: $group
Hosted-Script: $script
Hosted-Slug: $slug
Hosted-LibreOffice: $libreoffice
Hosted-Poppler: $poppler
Hosted-Evidence: $evidence
Hosted-Deadline: $deadline")
# Written before the push, so a cleanup after a push cut short still finds what to cancel.
printf '%s\n' "$request" >"$state/request"
app push -q --no-thin --force "$remote" "$request:refs/heads/ci/hosted/$suffix"
say "request ci/hosted/$suffix $request"
say "https://github.com/$APP/actions?query=branch%3Aci%2Fhosted%2F$suffix"

# main, a day old, moves to this request when the requested commit is landed work: MAWS's compare API answers that master
# holds it (ahead or identical), with the tree this request was made from. A fast-forward or nothing (main's ruleset);
# another waiter's push first is fine.
main_age=$(($(date +%s) - $(app show -s --format=%ct "$main_tip")))
if ((main_age > 24 * 3600)); then
  auth=()
  [[ -z ${GITHUB_TOKEN:-} ]] || auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  compare=${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY:-SSFSKIM/MAWS}/compare/$requested...master
  if ! answer=$(curl -fsS --retry 2 --max-time 30 "${auth[@]}" -H 'Accept: application/vnd.github+json' "$compare" 2>/dev/null); then
    say "main is $((main_age / 3600)) h old, but MAWS's compare API did not answer: main stays"
  elif ! jq -e --arg tree "$source_tree" '(.status == "ahead" or .status == "identical") and .base_commit.commit.tree.sha == $tree' >/dev/null <<<"$answer"; then
    say "main is $((main_age / 3600)) h old, but MAWS ${requested:0:12} is not on master: main stays"
  elif app push -q --no-thin "$remote" "$request:refs/heads/main" 2>/dev/null; then
    say "main moved to this request (it was $((main_age / 3600)) h old; MAWS ${requested:0:12} is on master)"
  else
    say "main not moved: its push was refused (another waiter's may have come first)"
  fi
fi

# The wait: one read of the result ref every POLL_SECONDS, until the deadline.
result_ref=refs/heads/ci/result/$suffix
ignored=
while :; do
  if (($(date +%s) >= deadline)); then
    say "no result by $(utc "$deadline"): the hosted job was still queued or running at GitHub"
    cancel_own 'no result by its deadline' || true
    exit 1
  fi
  if ! tip=$(tip_of "$result_ref" 2>"$state/poll.err"); then
    say "could not read ci/result/$suffix ($(tail -n 1 "$state/poll.err")); reading it again"
  elif [[ -n $tip && $tip != "$ignored" ]]; then
    if ! app fetch -q --depth=1 --filter=tree:0 "$remote" "$result_ref" 2>"$state/poll.err"; then
      say "could not fetch ci/result/$suffix ($(tail -n 1 "$state/poll.err")); fetching it again"
    elif [[ $(parents_of "$tip") != "$request" ]]; then
      say "ignoring ci/result/$suffix at ${tip:0:12}: its parent is not this request"
      ignored=$tip
    else
      break
    fi
  fi
  sleep "$POLL_SECONDS"
done

message=$(message_of "$tip")
conclusion=$(trailer "$message" Hosted-Conclusion)
say "${conclusion:-(no conclusion)} $(trailer "$message" Hosted-Run)"
# The body: the count lines and the failed tests, between the subject and the trailers.
awk 'BEGIN { RS = "" } { part[NR] = $0 } END { for (i = 2; i < NR; i++) print part[i] }' <<<"$message"
: >"$state/read"
app push -q "$remote" ":refs/heads/ci/hosted/$suffix" ":$result_ref" || say "could not delete ci/hosted/$suffix and ci/result/$suffix; the sweep will"
[[ $conclusion == success ]]
