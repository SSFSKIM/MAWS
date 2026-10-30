#!/usr/bin/env bash
# e2e:daemon-unit's cleanup (P5 O2 M7, docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md; the architect's ruling): boots
# out and removes every LaunchAgent under the e2e prefix `dev.maws.mawsd.e2e-` in this account, whichever run left it:
# the jobs `launchctl print gui/<uid>` lists and the plists in ~/Library/LaunchAgents. Nothing else is touched: every
# label is checked whole against the e2e pattern right before its bootout and its removal, and anything else (the
# owner's `dev.maws.mawsd`, a file name holding a space or a newline) is skipped and named. A job still loaded after its
# bootout, within a bounded wait, fails the sweep (exit 1). The group's spec runs it as its first step, and the gate job
# that ran the group runs it as its last, whatever happened (gate.yml's e2e job; the hosted overlay, maws-app's
# hosted-mac.yml), as gate-peer.sh's stop ends a peer group's job. A `mawsd` a job of ours started ends with its job; its
# hosts, in sessions of their own, are the spec's to kill with its scratch.
#
#   launchd-sweep.sh        LAUNCHCTL names the launchctl to call (its tests' stand-in), with none nothing is swept;
#                           LAUNCHD_SWEEP_WAIT_TENTHS bounds the wait for a booted-out job to leave (default 50: 5 s)
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
wait_tenths=${LAUNCHD_SWEEP_WAIT_TENTHS:-50}
prefix=dev.maws.mawsd.e2e-
e2e_label='^dev\.maws\.mawsd\.e2e-[A-Za-z0-9._-]+$'
domain=gui/$(id -u)
agents=$HOME/Library/LaunchAgents

is_e2e() { [[ $1 =~ $e2e_label ]]; }
loaded() { "$launchctl" print "$domain/$1" >/dev/null 2>&1; }

# The labels, one per line: the domain's listing (a grep match holds no space and no newline) and the plists on disk,
# each name checked whole; a name that is not an e2e label is reported and left alone.
on_disk=()
for plist in "$agents/$prefix"*.plist; do
  [[ -e $plist || -L $plist ]] || continue
  name=${plist##*/}
  if is_e2e "${name%.plist}"; then on_disk+=("${name%.plist}"); else echo "launchd-sweep: skipped $(printf '%q' "$plist"): not an e2e label"; fi
done
labels=$({
  "$launchctl" print "$domain" 2>/dev/null | grep -oE "${prefix//./\\.}[A-Za-z0-9._-]+" || true
  if ((${#on_disk[@]} > 0)); then printf '%s\n' "${on_disk[@]}"; fi
} | sort -u)

swept=0
failed=()
while IFS= read -r label; do
  [[ -n $label ]] || continue
  if ! is_e2e "$label"; then
    echo "launchd-sweep: skipped $(printf '%q' "$label"): not an e2e label"
    continue
  fi
  if loaded "$label"; then
    if is_e2e "$label"; then "$launchctl" bootout "$domain/$label" >/dev/null 2>&1 || true; fi
    tenth=0
    while loaded "$label" && ((tenth < wait_tenths)); do
      sleep 0.1
      tenth=$((tenth + 1))
    done
    if loaded "$label"; then
      echo "launchd-sweep: $label is still loaded after its bootout"
      failed+=("$label")
    else
      echo "launchd-sweep: booted out $label"
    fi
  fi
  plist=$agents/$label.plist
  if is_e2e "$label" && [[ -e $plist || -L $plist ]]; then
    rm -f -- "$plist"
    echo "launchd-sweep: removed $plist"
  fi
  swept=$((swept + 1))
done <<<"$labels"

echo "launchd-sweep: $swept e2e label(s) under $prefix swept in $domain"
if ((${#failed[@]} > 0)); then
  echo "launchd-sweep: ${#failed[@]} job(s) still loaded: ${failed[*]}" >&2
  exit 1
fi
