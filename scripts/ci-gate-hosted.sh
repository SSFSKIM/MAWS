# shellcheck shell=bash
# scripts/ci-gate.sh's download of the reports of its run's failed hosted groups (ci-kit's
# docs/doperpowers/specs/2026-10-26-maws-hosted-mac-design.md, The hosted workflow), sourced by it and by
# scripts/ci-gate-hosted.test.mjs. A hosted group's report stays in SSFSKIM/maws-app, as the artifact e2e-<slug> of the
# run that tested it; the group's waiter prints that run's URL as its verdict line, `hosted: <conclusion> <run URL>`.
# ci-gate.sh runs with its caller's gh login, which reads a public repository's artifacts, so it takes each failed
# group's report from there, beside the private run's own. No job in either repository reads the other's artifacts.

hosted_reports() { # <the failed jobs' logs, as gh run view --log-failed gives them> <the reports directory>
  local id
  for id in $(printf '%s\n' "$1" | perl -ne 'print "$1\n" if m{^e2e:[^\t]*\t[^\t]*\t\S+ hosted: (?!success )[a-z]+ https://github\.com/SSFSKIM/maws-app/actions/runs/(\d+)(?:/|$)}' | sort -un); do
    if gh -R SSFSKIM/maws-app run download "$id" -D "$2" 2>/dev/null; then
      echo "ci-gate: the hosted report of SSFSKIM/maws-app run $id in $2/"
    else
      echo "ci-gate: no hosted report from SSFSKIM/maws-app run $id"
    fi
  done
}
