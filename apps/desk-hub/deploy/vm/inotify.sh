# shellcheck shell=bash
# B1 step 11's reading on the devcloud acceptance VM, read only, while the production endpoint run is on (a client
# attached): the inotify watches and instances of the owner's processes (the engine host's user, `new`) against the
# kernel's per-user limits, with the five heaviest processes by their command name alone. Run as
# `devcloud vm ssh dc-acceptance-7f80 --root < vm/inotify.sh`.
set -uo pipefail
U=new
watches=0 instances=0
declare -A by
for p in $(pgrep -u $U); do
  for fd in /proc/"$p"/fd/*; do
    [[ $(readlink "$fd" 2>/dev/null) == "anon_inode:inotify" ]] || continue
    n=$(grep -c '^inotify wd:' /proc/"$p"/fdinfo/"${fd##*/}" 2>/dev/null) || n=0
    instances=$((instances + 1)); watches=$((watches + n))
    by["$p $(cat /proc/"$p"/comm 2>/dev/null)"]=$(( ${by["$p $(cat /proc/"$p"/comm 2>/dev/null)"]:-0} + n ))
  done
done
printf 'at %s\n' "$(date -u +%FT%TZ)"
printf 'user %s: %d inotify watches of max_user_watches %s; %d instances of max_user_instances %s\n' \
  $U $watches "$(cat /proc/sys/fs/inotify/max_user_watches)" $instances "$(cat /proc/sys/fs/inotify/max_user_instances)"
for k in "${!by[@]}"; do printf '%s %s\n' "${by[$k]}" "$k"; done | sort -rn | head -5 | sed 's/^/  watches, pid, command: /'
