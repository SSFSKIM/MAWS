#!/bin/bash
# P5 O15 M4's rows 15a to 15c (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, M4's table): the local
# boundary on a Linux machine running MAWS's `mawsd` as a systemd user unit. Read only. Run as that user, with
# XDG_RUNTIME_DIR set so `systemctl --user` reaches the user's manager:
#   bash o15-sockets.sh
# It lists every socket, directory and symlink under the profile (${XDG_CONFIG_HOME:-~/.config}/MAWS) with its type,
# mode and owner, and the listening TCP sockets of `mawsd` and its hosts (of the unit's main process, its descendants and
# everything in the unit's control group, which the hosts a restart left running stay in, each process that runs a
# release's binary; one that runs another, a session's own tool, is a NOTE). Expected: the sockets under
# <profile>/mawsd/ and <profile>/supervisor/ and <profile>/endpoint/rl10.sock, each the user's, mode 0600 in a 0700
# directory; no symlink; one listener that is not loopback, the endpoint's direct listener, TCP 47830 on the machine's
# tailnet addresses and on no other (src/endpoint/direct-listener.ts); no loopback listener but the connectors' sign-in
# listener while a sign-in runs. Outside the profile it reads the X server's sockets under /tmp/.X11-unix and each
# running Xvfb's -auth file (its owner and mode, never its contents).
# A `FLAG` line names each departure, a `NOTE` what the reader judges; the last line is `PASS` with no flag, else
# `FAIL <n> flag(s)` (exit 1). Paths under the profile are printed relative to it; a listener's address only as its
# class (tailnet, loopback, wildcard, other); the user as `self`; $HOME as `~`. Nothing else of the machine is printed.
set -uo pipefail

PROFILE=${XDG_CONFIG_HOME:-$HOME/.config}/MAWS
# where mawsd's releases and the render host's runtime live (src/mawsd/release.ts, render-runtime.ts): a host's binary
RELEASES=$HOME/.local/share/maws/mawsd
UNIT=mawsd.service
DIRECT_PORT=47830
ME=$(id -un)
flags=0

flag() {
  echo "FLAG $*"
  flags=$((flags + 1))
}
owner() { if [[ $1 == "$ME" ]]; then echo self; else echo "$1"; fi; }
home() { echo "${1/#$HOME/\~}"; }

# ---- under the profile --------------------------------------------------------------------------------------------

if [[ ! -d $PROFILE ]]; then
  echo "FAIL no profile at $(home "$PROFILE")"
  exit 1
fi
[[ -L $PROFILE ]] && flag "the profile $(home "$PROFILE") is itself a symlink"
echo "== under the profile, $(home "$PROFILE") (type mode owner path; d directory, s socket, l symlink)"
while IFS=$'\t' read -r type mode user rel; do
  [[ -n $rel ]] || rel=.
  echo "$type $mode $(owner "$user") $rel"
  case $type in
    l) flag "$rel is a symlink" ;;
    s)
      [[ $user == "$ME" ]] || flag "$rel is owned by $(owner "$user"), not the user"
      [[ $mode == 600 ]] || flag "$rel is mode 0$mode, not 0600"
      parent=$(stat -c %a "$(dirname "$PROFILE/$rel")" 2>/dev/null)
      [[ $parent == 700 ]] || flag "$rel is in a directory of mode 0${parent:-?}, not 0700"
      case $rel in
        mawsd/* | supervisor/* | endpoint/rl10.sock) ;;
        *) echo "NOTE $rel is a socket outside mawsd/, supervisor/ and endpoint/rl10.sock" ;;
      esac
      ;;
  esac
done < <(find -H "$PROFILE" \( -type s -o -type d -o -type l \) -printf '%y\t%m\t%u\t%P\n' 2>/dev/null | sort -t $'\t' -k4,4)

# The long-path fallbacks put a socket under the temporary directory instead (src/endpoint/rl10/server.ts's
# `mawsd-rl10-<uid>-<hash>`): listed when there is one.
while IFS=$'\t' read -r mode user rel; do
  echo "NOTE outside the profile: s $mode $(owner "$user") \$TMPDIR/$rel (a long-path fallback)"
  [[ $user == "$ME" && $mode == 600 ]] || flag "\$TMPDIR/$rel is $(owner "$user")'s, mode 0$mode"
done < <(find "${TMPDIR:-/tmp}" -maxdepth 2 -path "*/mawsd-*" -type s -printf '%m\t%u\t%P\n' 2>/dev/null | sort)

# ---- the listeners of mawsd and its hosts ------------------------------------------------------------------------

echo "== listening TCP sockets of mawsd and its hosts (port class process)"
main=$(systemctl --user show "$UNIT" -p MainPID --value 2>/dev/null)
group=$(systemctl --user show "$UNIT" -p ControlGroup --value 2>/dev/null)
declare -A ours=()
if [[ ! $main =~ ^[1-9][0-9]*$ ]]; then
  flag "$UNIT has no main process: its listeners are unread"
else
  ours[$main]=1
  # the unit's control group, every level of it
  if [[ -n $group && -d /sys/fs/cgroup$group ]]; then
    while read -r pid; do ours[$pid]=1; done < <(find "/sys/fs/cgroup$group" -name cgroup.procs -exec cat {} + 2>/dev/null)
  fi
  # the main process's descendants, wherever they run
  declare -A children=()
  while read -r pid ppid; do children[$ppid]+=" $pid"; done < <(ps -e -o pid=,ppid=)
  queue=("$main")
  while ((${#queue[@]})); do
    pid=${queue[0]}
    queue=("${queue[@]:1}")
    # shellcheck disable=SC2086 # the children's pids, split on purpose
    for child in ${children[$pid]:-}; do
      [[ -n ${ours[$child]:-} && $child != "$main" ]] && continue
      ours[$child]=1
      queue+=("$child")
    done
  done
  echo "($((${#ours[@]})) processes: the unit's main process, its descendants and its control group)"
fi

class() {
  local host=${1%:*}
  host=${host#[}
  host=${host%]}
  host=${host%%%*}
  case $host in
    100.6[4-9].* | 100.[7-9][0-9].* | 100.1[01][0-9].* | 100.12[0-7].*) echo tailnet-v4 ;;
    [fF][dD]7[aA]:115[cC]:[aA]1[eE]0:*) echo tailnet-v6 ;;
    127.* | ::1 | ::ffff:127.*) echo loopback ;;
    0.0.0.0 | '*' | :: | '') echo wildcard ;;
    *) echo other ;;
  esac
}

# Whether a process is one of mawsd's own (mawsd and its hosts run a binary of a release): a session's own process, a
# tool the agent started, is not.
is_host() {
  local exe
  exe=$(readlink "/proc/$1/exe" 2>/dev/null)
  [[ $exe == "$RELEASES"/* ]]
}

direct=0
if ((${#ours[@]})); then
  while read -r _ _ _ local _ users; do
    [[ -n ${local:-} ]] || continue
    mine=''
    while read -r pid; do [[ -n ${ours[$pid]:-} ]] && mine=$pid; done < <(grep -o 'pid=[0-9]*' <<<"$users" | cut -d= -f2)
    [[ -n $mine ]] || continue
    port=${local##*:}
    kind=$(class "$local")
    name=$(grep -o '(("[^"]*"' <<<"$users" | head -1 | cut -d'"' -f2)
    if ! is_host "$mine"; then
      echo "NOTE a listener on $port ($kind) of ${name:-?}, a process under the unit that runs no release binary (a session's own tool?)"
      continue
    fi
    echo "tcp $port $kind ${name:-?}"
    if [[ $port == "$DIRECT_PORT" ]]; then
      if [[ $kind == tailnet-v4 || $kind == tailnet-v6 ]]; then direct=$((direct + 1)); else flag "the direct listener ($port) on a $kind address, not the tailnet's alone"; fi
    elif [[ $kind == loopback ]]; then
      flag "a loopback listener on $port (${name:-?}): it passes only as the connectors' sign-in listener while a sign-in runs"
    else
      flag "a listener on $port on a $kind address (${name:-?}), outside the expected set"
    fi
  done < <(ss -ltnpH 2>/dev/null)
  ((direct)) || echo "NOTE no direct listener on $DIRECT_PORT (is the endpoint enrolled and its listener on?)"
fi

# ---- outside the profile: the X server -------------------------------------------------------------------------

echo "== outside the profile: the X server's sockets (type mode owner path)"
if [[ -d /tmp/.X11-unix ]]; then
  while IFS=$'\t' read -r type mode user rel; do
    echo "$type $mode $(owner "$user") /tmp/.X11-unix${rel:+/$rel}"
  done < <(find /tmp/.X11-unix -maxdepth 1 \( -type d -o -type s \) -printf '%y\t%m\t%u\t%P\n' 2>/dev/null | sort -t $'\t' -k4,4)
else
  echo "(no /tmp/.X11-unix)"
fi
echo "== outside the profile: each running Xvfb's -auth file (display owner auth)"
xvfbs=$(pgrep -x Xvfb 2>/dev/null)
[[ -n $xvfbs ]] || echo "(no Xvfb running)"
for pid in $xvfbs; do
  mapfile -d '' -t argv </proc/"$pid"/cmdline 2>/dev/null || continue
  display='' auth=''
  for ((i = 1; i < ${#argv[@]}; i++)); do
    [[ -z $display && ${argv[i]} == :* ]] && display=${argv[i]}
    [[ ${argv[i]} == -auth ]] && auth=${argv[i + 1]:-}
  done
  user=$(ps -o user= -p "$pid" 2>/dev/null)
  if [[ -z $auth ]]; then
    echo "Xvfb ${display:-?} $(owner "${user:-?}") no -auth argument"
    echo "NOTE Xvfb ${display:-?} has no -auth file: the server checks no cookie"
  elif [[ -e $auth ]]; then
    echo "Xvfb ${display:-?} $(owner "${user:-?}") -auth $(home "$auth"), mode 0$(stat -c %a "$auth"), owner $(owner "$(stat -c %U "$auth")")"
  else
    echo "Xvfb ${display:-?} $(owner "${user:-?}") -auth $(home "$auth"), which does not exist"
  fi
done

if ((flags)); then
  echo "FAIL $flags flag(s)"
  exit 1
fi
echo "PASS no flags"
