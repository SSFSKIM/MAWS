# shellcheck shell=bash
# scripts/ci-gate.sh's reads of GitHub through an exhausted API budget, sourced by it and by scripts/ci-gate-pace.test.mjs
# (and by the tests of the helpers that read through it). Every session on the owner's account shares one 5,000-request
# hour of REST budget, and it has run out mid-gate: each read then failed at once, the watch counted them as a run that
# cannot be read and gave up, and the ref went while the run still ran (MAWS run 42802241165, 2026-11-10). ci-kit's
# ci-gate waits such a limit out the same way (SSFSKIM/ci-kit cli/pace.mjs).
#
# paced_gh runs gh with its arguments. An answer gh names a rate limit (API rate limit exceeded, or a secondary rate
# limit, with HTTP 403 or 429) is waited out and the call made again; any other answer is the caller's, stdout, stderr and
# status as gh gave them, the stdout of a failed attempt never mixed into a later one's. A wait reads the core budget
# from GET /rate_limit, which GitHub does not count, and sleeps until its reset plus RESET_SLACK s when nothing remains,
# or PACE_RETRY s when something does (a secondary limit, or a budget that could not be read). Each wait is one line on
# descriptor PACE_NOTES_FD, stderr unless the caller names another (ci-gate.sh names its own stderr, which a read's
# redirect of its stderr does not reach); after it the budget is read again, and a reset that moved while the window
# refilled and drained is waited for too. The wait is bounded: a wait that would end past LIMIT_WAIT s of continuous
# exhaustion (one hour's window, plus a reset that moved once, as ci-kit's bound) is not begun, the limited answer
# going back to the caller, which ends as it would on any failed read; later limited answers go back at once until an
# answer that is not the limit.
#
# The exhaustion outlives the subshell a call runs in (most reads are command substitutions), so it is kept in
# PACE_MARK: the second it began, or `over` past the bound; any answer that is not the limit removes it. ci-gate.sh's
# finish removes it too, after asking pace_limited whether the budget is why it found no run. One a killed call left
# under a reused pid is removed as the helper loads.
# shellcheck disable=SC2034 # the bounds are read by the tests too

LIMIT_WAIT=$((90 * 60))
RESET_SLACK=5
PACE_RETRY=60
PACE_MARK=${TMPDIR:-/tmp}/ci-gate-pace.$$
PACE_NOTES_FD=${PACE_NOTES_FD:-2}
rm -f "$PACE_MARK"

paced_gh() {
  local out err status
  out=$(mktemp) && err=$(mktemp) || return 1
  while :; do
    gh "$@" >"$out" 2>"$err"
    status=$?
    # Any answer but the limit, a failure or a 304 too (gh exits 1 on one), says the exhaustion is over.
    if ((status == 0)) || ! rate_limited "$err"; then
      rm -f "$PACE_MARK"
      break
    fi
    pace_wait || break
  done
  cat "$out"
  cat "$err" >&2
  rm -f "$out" "$err"
  return "$status"
}

# Whether gh's stderr, in the file, names a rate limit.
rate_limited() { # <gh's stderr>
  grep -qiE 'API rate limit exceeded|secondary rate limit' "$1" && grep -qE '(^|[^0-9])(403|429)([^0-9]|$)' "$1"
}

# Whether the last read through paced_gh was limited (being waited out, or past the bound).
pace_limited() {
  [[ -e $PACE_MARK ]]
}

# The core budget's remaining and reset, space-separated, or nothing when it cannot be read.
pace_budget() {
  gh api rate_limit --jq '"\(.resources.core.remaining) \(.resources.core.reset)"' 2>/dev/null
}

pace_iso() { # <epoch second>
  perl -MPOSIX=strftime -e 'print strftime("%Y-%m-%dT%H:%M:%SZ", gmtime($ARGV[0]))' "$1"
}

# Sleeps until the limit lifts, as GET /rate_limit tells; fails past the bound.
pace_wait() {
  local now since remaining reset until resets
  now=$(date +%s)
  since=$(cat "$PACE_MARK" 2>/dev/null)
  [[ $since != over ]] || return 1
  [[ $since =~ ^[0-9]+$ ]] || { since=$now; echo "$since" >"$PACE_MARK"; }
  read -r remaining reset <<<"$(pace_budget)"
  while :; do
    if [[ $remaining == 0 && $reset =~ ^[0-9]+$ ]] && ((reset + RESET_SLACK > now)); then
      until=$((reset + RESET_SLACK))
    else
      until=$((now + PACE_RETRY))
    fi
    if ((until - since > LIMIT_WAIT)); then
      echo over >"$PACE_MARK"
      echo "ci-gate: the GitHub API rate limit would outlast $((LIMIT_WAIT / 60)) min of waiting (until $(pace_iso "$until")); no longer waiting for it" >&"$PACE_NOTES_FD"
      return 1
    fi
    resets=unknown
    [[ ! $reset =~ ^[0-9]+$ ]] || resets=$(pace_iso "$reset")
    echo "ci-gate: the GitHub API rate limit is reached (remaining ${remaining:-unknown}, resets $resets); waiting until $(pace_iso "$until")" >&"$PACE_NOTES_FD"
    sleep $((until - now))
    now=$(date +%s)
    read -r remaining reset <<<"$(pace_budget)"
    # Anything left, or a budget that cannot be read: the call itself will tell.
    [[ $remaining == 0 ]] || return 0
  done
}
