#!/usr/bin/env bash
# e2e:daemon-unit's cleanup (P5 O2 M7, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md; the architect's ruling): boots
# out and removes every LaunchAgent under the e2e prefix `dev.maws.mawsd.e2e-` in this account, whichever run left it:
# the jobs `launchctl print gui/<uid>` lists and the plists in ~/Library/LaunchAgents. Nothing else is touched: the
# owner's `dev.maws.mawsd` and every other label stay. The group's spec runs it as its first step, and the gate job that
# ran the group runs it as its last, whatever happened (gate.yml's e2e job; the hosted overlay, maws-app's
# hosted-mac.yml), as gate-peer.sh's stop ends a peer group's job. A `mawsd` a job of ours started ends with its job; its
# hosts, in sessions of their own, are the spec's to kill with its scratch.
#
#   launchd-sweep.sh        LAUNCHCTL names the launchctl to call (its tests' stand-in); with none, nothing is swept
set -euo pipefail

(($# == 0)) || {
  echo 'usage: launchd-sweep.sh' >&2
  exit 2
}
launchctl=${LAUNCHCTL:-launchctl}
if ! command -v "$launchctl" >/dev/null 2>&1; then
  echo "launchd-sweep: no $launchctl here; nothing to sweep"
  exit 0
fi
prefix=dev.maws.mawsd.e2e-
domain=gui/$(id -u)
agents=$HOME/Library/LaunchAgents

# One reading of the domain and the directory, then the removals.
labels=$({
  "$launchctl" print "$domain" 2>/dev/null | grep -oE "${prefix//./\\.}[A-Za-z0-9._-]+" || true
  for plist in "$agents/$prefix"*.plist; do
    if [[ -e $plist ]]; then basename "$plist" .plist; fi
  done
} | sort -u)

swept=0
for label in $labels; do
  if "$launchctl" print "$domain/$label" >/dev/null 2>&1; then
    if "$launchctl" bootout "$domain/$label" 2>/dev/null; then echo "launchd-sweep: booted out $label"; else echo "launchd-sweep: bootout of $label failed"; fi
  fi
  if [[ -e $agents/$label.plist ]]; then
    rm -f -- "$agents/$label.plist"
    echo "launchd-sweep: removed $agents/$label.plist"
  fi
  swept=$((swept + 1))
done
echo "launchd-sweep: $swept e2e label(s) under $prefix swept in $domain"
