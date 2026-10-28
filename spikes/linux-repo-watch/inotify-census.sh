#!/usr/bin/env bash
# P5 O3-G (research/org/p5-o3-linux-repo-watch.md): who holds inotify instances and watches on this host, per user and
# per process, against the per-user limits. Run with sudo to see every user's processes.
set -euo pipefail
echo "limits: max_user_watches=$(cat /proc/sys/fs/inotify/max_user_watches) max_user_instances=$(cat /proc/sys/fs/inotify/max_user_instances) max_queued_events=$(cat /proc/sys/fs/inotify/max_queued_events)"
declare -A inst watches
rows=()
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  n=0 w=0
  for fd in "$p"/fd/*; do
    [[ $(readlink "$fd" 2>/dev/null) == anon_inode:inotify ]] || continue
    n=$((n + 1))
    w=$((w + $(grep -c '^inotify wd:' "$p/fdinfo/${fd##*/}" 2>/dev/null || true)))
  done
  ((n)) || continue
  user=$(stat -c %U "$p" 2>/dev/null || echo '?')
  inst[$user]=$(( ${inst[$user]:-0} + n )); watches[$user]=$(( ${watches[$user]:-0} + w ))
  rows+=("$(printf '%-10s %7s %3s inst %6s watches  %s' "$user" "$pid" "$n" "$w" "$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null | cut -c1-90)")")
done
printf '%s\n' "${rows[@]}" | sort -k5 -n -r | head -40
for u in "${!inst[@]}"; do echo "user $u: ${inst[$u]} instances, ${watches[$u]} watches"; done
