# shellcheck shell=bash
# scripts/ci-gate.sh's retry of the jobs a spot preemption ended (docs/doperpowers/plans/2026-10-14-gate-offload.md
# Decision Log 69, 70), sourced by it and by scripts/ci-gate-preemptions.test.mjs. It reads ci-gate.sh's REPO and run_id
# and calls its await_run, which returns once `gh run view` shows the run completed, and its finish, when the run's jobs
# cannot be read.
# shellcheck disable=SC2154,SC2034 # those are ci-gate.sh's, and so is printing the summary it sets

# When GCE preempts a pool VM mid-job, GitHub concludes the job `failure`, as it does a red test, with the annotations
# "The operation was canceled." and "Process completed with exit code 130." (ci-kit's simulated preemption,
# SSFSKIM/ci-kit-sandbox run 38927837115). A preempted job is one that concluded so on a `ci-kit-gce-*` runner, in a
# run not itself cancelled, with no timeout annotation: a job past its timeout-minutes reads "The operation was
# canceled." too, beside "… has exceeded the maximum execution time …", and is red. Prints them, "id<TAB>name" lines,
# from the jobs of the run's latest attempt, "id<TAB>conclusion<TAB>runner<TAB>name" lines; settle_run asks only of a
# run not cancelled. A job whose annotations cannot be read is not one. Only a job that ran in the attempt carries
# annotations: GitHub copies the jobs a rerun leaves alone into the new attempt under new ids and without them.
preempted_jobs() { # <the jobs>
  local id conclusion runner name notes
  while IFS=$'\t' read -r id conclusion runner name; do
    [[ $conclusion == failure && $runner == ci-kit-gce-* ]] || continue
    notes=$'\n'$(gh api --paginate "repos/$REPO/check-runs/$id/annotations?per_page=100" --jq '.[].message' </dev/null)$'\n' || continue
    [[ $notes == *$'\nThe operation was canceled.\n'* && $notes != *'exceeded the maximum execution time'* ]] || continue
    printf '%s\t%s\n' "$id" "$name"
  done <<<"$1"
}

# Whether a list of names, one a line, holds the name.
listed() { # <list> <name>
  [[ $'\n'$1 == *$'\n'"$2"$'\n'* ]]
}

# Waits for the run and reruns each preempted job alone, once per job per run, waiting again after each, until an
# attempt leaves nothing to rerun; then sets run_attempt, conclusion, jobs (the final attempt's "conclusion<TAB>name" lines,
# sorted by name) and preemptions, the line naming each preempted job and how it ended (empty when none was).
# One at a time because GitHub refuses a job rerun while the run is running; by name because a job's id changes with
# every attempt. A job preempted on its rerun stays red.
# Only an attempt the run API shows completed, its jobs read, is acted on: `gh run view`, which await_run trusts, can
# still show the attempt before a rerun completed while the API shows the rerun's running, and a job not read has no id
# to rerun it by. Anything else is read again once await_run returns; reads that keep failing end the gate red, as
# await_run's do.
# Its lists of names hold one whole name a line: a job's name can have spaces in it (unit's shards, `unit <k>/<n>`).
settle_run() {
  local rows found id name pending='' retried='' twice='' refused='' next rerun_err started observed run_status unread=0
  while :; do
    await_run
    # The attempt, its status and its conclusion from one observation of the run, then that attempt's jobs.
    if observed=$(gh api "repos/$REPO/actions/runs/$run_id" --jq '"\(.run_attempt)\t\(.status)\t\(.conclusion)"'); then
      IFS=$'\t' read -r run_attempt run_status conclusion <<<"$observed"
    else
      run_status=unread
    fi
    if [[ $run_status == completed ]] && ! rows=$(gh api --paginate "repos/$REPO/actions/runs/$run_id/attempts/$run_attempt/jobs?per_page=100" --jq '.jobs[] | [.id, (.conclusion // .status), (.runner_name // ""), .name] | @tsv'); then
      run_status=unread
    fi
    if [[ $run_status != unread ]]; then
      unread=0
    else
      unread=$((unread + 1))
      if ((unread >= 20)); then
        echo "ci-gate: the jobs of run $run_id cannot be read" >&2
        finish 1
      fi
    fi
    # Not settled yet.
    [[ $run_status == completed ]] || { sleep 1; continue; }
    jobs=$(printf '%s\n' "$rows" | cut -f2,4 | sort -t$'\t' -k2)
    # In a cancelled run nothing is a preemption, and nothing found before is rerun.
    [[ $conclusion != cancelled ]] || break
    found=$(preempted_jobs "$rows")
    while IFS=$'\t' read -r id name; do
      [[ -n $name ]] || continue
      if listed "$retried" "$name"; then
        listed "$twice" "$name" || { twice+=$name$'\n'; echo "ci-gate: $name preempted again in attempt $run_attempt; it stays red"; }
      elif ! listed "$pending$refused" "$name"; then
        pending+=$name$'\n'
        echo "ci-gate: $name preempted in attempt $run_attempt"
      fi
    done <<<"$found"
    next=${pending%%$'\n'*}
    [[ -n $next ]] || break
    pending=${pending#*$'\n'}
    id=$(printf '%s\n' "$rows" | awk -F'\t' -v name="$next" '$4 == name { print $1; exit }')
    # gh reruns the whole run on an empty --job: a job is rerun by an id read for it, or not at all.
    case $id in
      '' | *[!0-9]*)
        echo "ci-gate: $next has no job id in attempt $run_attempt to rerun it by; it stays red"
        refused+=$next$'\n'
        continue ;;
    esac
    if ! rerun_err=$(gh -R "$REPO" run rerun "$run_id" --job "$id" 2>&1); then
      echo "ci-gate: $next's rerun was refused: $rerun_err; it stays red"
      refused+=$next$'\n'
      continue
    fi
    echo "ci-gate: rerunning $next alone as attempt $((run_attempt + 1))"
    # The rerun is accepted before the run reads as running again: wait for its attempt, so await_run does not return on
    # the one just read.
    for _ in $(seq 1 30); do
      started=$(gh api "repos/$REPO/actions/runs/$run_id" --jq .run_attempt 2>/dev/null)
      [[ ${started:-0} -gt $run_attempt ]] && break
      sleep 2
    done
    if [[ ${started:-0} -le $run_attempt ]]; then
      echo "ci-gate: run $run_id shows no attempt $((run_attempt + 1)) a minute after the rerun; $next stays red"
      refused+=$next$'\n'
      break
    fi
    retried+=$next$'\n'
  done
  preemptions=''
  [[ -n $retried$refused ]] || return 0
  # Through the environment, since awk's -v takes no newline.
  preemptions=$(printf '%s\n' "$jobs" | retried=${retried%$'\n'} twice=${twice%$'\n'} refused=${refused%$'\n'} awk -F'\t' '
    BEGIN {
      n = split(ENVIRON["retried"], names, "\n"); for (i = 1; i <= n; i++) isretried[names[i]] = 1
      n = split(ENVIRON["twice"], names, "\n"); for (i = 1; i <= n; i++) istwice[names[i]] = 1
      n = split(ENVIRON["refused"], names, "\n"); for (i = 1; i <= n; i++) isrefused[names[i]] = 1
    }
    !($2 in isretried) && !($2 in isrefused) { next }
    { all = all " " $2; nall++ }
    $2 in isrefused { r = r " " $2; next }
    $2 in istwice { t = t " " $2; next }
    $1 == "success" { g = g " " $2; next }
    { d = d " " $2 ($1 == "failure" ? "" : " (" $1 ")") }
    END {
      printf "ci-gate: preempted by GCE (%d):%s%s%s%s%s\n", nall, all, (g ? "; green on its rerun:" g : ""), (d ? "; red on its rerun:" d : ""),
        (t ? "; preempted twice, red:" t : ""), (r ? "; not rerun, red:" r : "")
    }')
}
