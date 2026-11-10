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
# A `FLAG` line names each departure, a `NOTE` what the reader judges, a `FAIL unread: <what>` a read that failed (a
# command's error, a subtree `find` could not enter): the run then proves nothing and ends `FAIL`, never `PASS`. The last
# line is `PASS` with no flag and nothing unread, else `FAIL …` (exit 1). Paths under the profile are printed relative to it; a listener's address only as its
# class (tailnet, loopback, wildcard, other); the user as `self`; $HOME as `~`. Nothing else of the machine is printed.
set -uo pipefail

PROFILE=${XDG_CONFIG_HOME:-$HOME/.config}/MAWS
# where mawsd's releases and the render host's runtime live (src/mawsd/release.ts, render-runtime.ts): a host's binary
RELEASES=$HOME/.local/share/maws/mawsd
UNIT=mawsd.service
DIRECT_PORT=47830
ME=$(id -un)
flags=0
unread=0

flag() {
  echo "FLAG $*"
  flags=$((flags + 1))
}
# A read that failed: the inventory is incomplete, so the run cannot pass. The command's own words are not printed
# (they name paths outside the profile).
failed() {
  echo "FAIL unread: $*"
  unread=$((unread + 1))
}
owner() { if [[ $1 == "$ME" ]]; then echo self; else echo "$1"; fi; }
home() { echo "${1/#$HOME/\~}"; }
ERR=$(mktemp) || {
  echo "FAIL unread: no temporary file for the commands' errors"
  exit 1
}
trap 'rm -f "$ERR"' EXIT
# `run <what> <command…>`: the command's output into $OUT; a non-zero status (find's for a subtree it could not enter
# included) is `FAIL unread: <what>`, with how many error lines it wrote.
run() {
  local what=$1 rc=0
  shift
  OUT=$("$@" 2>"$ERR") || rc=$?
  ((rc == 0)) && return 0
  failed "$what (exit $rc, $(wc -l <"$ERR" | tr -d ' ') error line(s))"
  return 1
}

# ---- under the profile --------------------------------------------------------------------------------------------

if [[ ! -d $PROFILE ]]; then
  echo "FAIL no profile at $(home "$PROFILE")"
  exit 1
fi
[[ -L $PROFILE ]] && flag "the profile $(home "$PROFILE") is itself a symlink"
echo "== under the profile, $(home "$PROFILE") (type mode owner path; d directory, s socket, l symlink)"
if run "the profile's sockets, directories and symlinks (find)" find -H "$PROFILE" \( -type s -o -type d -o -type l \) -printf '%y\t%m\t%u\t%P\n'; then
  while IFS=$'\t' read -r type mode user rel; do
    [[ -n $type ]] || continue
    [[ -n $rel ]] || rel=.
    echo "$type $mode $(owner "$user") $rel"
    case $type in
      l) flag "$rel is a symlink" ;;
      s)
        [[ $user == "$ME" ]] || flag "$rel is owned by $(owner "$user"), not the user"
        [[ $mode == 600 ]] || flag "$rel is mode 0$mode, not 0600"
        if parent=$(stat -c %a "$(dirname "$PROFILE/$rel")" 2>/dev/null); then
          [[ $parent == 700 ]] || flag "$rel is in a directory of mode 0$parent, not 0700"
        else
          failed "the mode of $rel's directory (stat)"
        fi
        case $rel in
          mawsd/* | supervisor/* | endpoint/rl10.sock) ;;
          *) echo "NOTE $rel is a socket outside mawsd/, supervisor/ and endpoint/rl10.sock" ;;
        esac
        ;;
    esac
  done < <(sort -t $'\t' -k4,4 <<<"$OUT")
fi

# The long-path fallbacks put a socket under the temporary directory instead (src/endpoint/rl10/server.ts's
# `mawsd-rl10-<uid>-<hash>`): the user's `mawsd-*` directories there, and their sockets, listed when there are any.
TMP=${TMPDIR:-/tmp}
if run "the temporary directory's mawsd-* directories (find)" find "$TMP" -mindepth 1 -maxdepth 1 -name 'mawsd-*' -type d -user "$ME" -printf '%P\n'; then
  fallbacks=$OUT
  while read -r dir; do
    [[ -n $dir ]] || continue
    run "\$TMPDIR/$dir's sockets (find)" find "$TMP/$dir" -maxdepth 1 -type s -printf '%m\t%u\t%P\n' || continue
    while IFS=$'\t' read -r mode user name; do
      [[ -n $mode ]] || continue
      echo "NOTE outside the profile: s $mode $(owner "$user") \$TMPDIR/$dir/$name (a long-path fallback)"
      [[ $user == "$ME" && $mode == 600 ]] || flag "\$TMPDIR/$dir/$name is $(owner "$user")'s, mode 0$mode"
    done <<<"$OUT"
  done <<<"$fallbacks"
fi

# ---- the listeners of mawsd and its hosts ------------------------------------------------------------------------

echo "== listening TCP sockets of mawsd and its hosts (port class process)"
declare -A ours=()
main='' group=''
run "$UNIT's main process (systemctl --user show)" systemctl --user show "$UNIT" -p MainPID --value && main=$OUT
run "$UNIT's control group (systemctl --user show)" systemctl --user show "$UNIT" -p ControlGroup --value && group=$OUT
if [[ ! $main =~ ^[1-9][0-9]*$ ]]; then
  [[ -z $main ]] || failed "$UNIT has no main process (MainPID $main): its listeners"
else
  ours[$main]=1
  # the unit's control group, every level of it
  if [[ -z $group || ! -d /sys/fs/cgroup$group ]]; then
    failed "$UNIT's control group (not under /sys/fs/cgroup)"
  elif run "$UNIT's control group's processes (find cgroup.procs)" find "/sys/fs/cgroup$group" -name cgroup.procs -exec cat {} +; then
    while read -r pid; do [[ -n $pid ]] && ours[$pid]=1; done <<<"$OUT"
  fi
  # the main process's descendants, wherever they run
  declare -A children=()
  if run "the process table (ps)" ps -e -o pid=,ppid=; then
    while read -r pid ppid; do [[ -n $pid ]] && children[$ppid]+=" $pid"; done <<<"$OUT"
  fi
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

direct=0
if ((${#ours[@]})) && run "the listening TCP sockets (ss -ltnpH)" ss -ltnpH; then
  while read -r _ _ _ local _ users; do
    [[ -n ${local:-} ]] || continue
    mine=''
    while read -r pid; do [[ -n $pid && -n ${ours[$pid]:-} ]] && mine=$pid; done < <(grep -o 'pid=[0-9]*' <<<"$users" | cut -d= -f2)
    [[ -n $mine ]] || continue
    port=${local##*:}
    kind=$(class "$local")
    name=$(grep -o '(("[^"]*"' <<<"$users" | head -1 | cut -d'"' -f2)
    # Whether it is one of mawsd's own (mawsd and its hosts run a binary of a release): a session's own process, a tool
    # the agent started, is not.
    if ! exe=$(readlink "/proc/$mine/exe" 2>/dev/null); then
      failed "the binary of the process listening on $port (${name:-?})"
      continue
    fi
    if [[ $exe != "$RELEASES"/* ]]; then
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
  done <<<"$OUT"
  ((direct)) || echo "NOTE no direct listener on $DIRECT_PORT (is the endpoint enrolled and its listener on?)"
fi

# ---- outside the profile: the X server -------------------------------------------------------------------------

echo "== outside the profile: the X server's sockets (type mode owner path)"
if [[ ! -e /tmp/.X11-unix ]]; then
  echo "(no /tmp/.X11-unix)"
elif run "/tmp/.X11-unix (find)" find /tmp/.X11-unix -maxdepth 1 \( -type d -o -type s \) -printf '%y\t%m\t%u\t%P\n'; then
  while IFS=$'\t' read -r type mode user rel; do
    [[ -n $type ]] || continue
    echo "$type $mode $(owner "$user") /tmp/.X11-unix${rel:+/$rel}"
  done < <(sort -t $'\t' -k4,4 <<<"$OUT")
fi
echo "== outside the profile: each running Xvfb's -auth file (display owner auth)"
xvfbs=''
if xvfbs=$(pgrep -x Xvfb 2>"$ERR"); then
  :
elif (($? == 1)); then
  echo "(no Xvfb running)" # pgrep's 1: nothing matched
else
  failed "the running Xvfb processes (pgrep)"
fi
for pid in $xvfbs; do
  if ! mapfile -d '' -t argv <"/proc/$pid/cmdline" 2>/dev/null || ((${#argv[@]} == 0)); then
    failed "Xvfb $pid's command line"
    continue
  fi
  display='' auth=''
  for ((i = 1; i < ${#argv[@]}; i++)); do
    [[ -z $display && ${argv[i]} == :* ]] && display=${argv[i]}
    [[ ${argv[i]} == -auth ]] && auth=${argv[i + 1]:-}
  done
  if ! user=$(ps -o user= -p "$pid" 2>/dev/null); then
    failed "Xvfb ${display:-?}'s owner (ps)"
    continue
  fi
  if [[ -z $auth ]]; then
    echo "Xvfb ${display:-?} $(owner "$user") no -auth argument"
    echo "NOTE Xvfb ${display:-?} has no -auth file: the server checks no cookie"
  elif [[ ! -e $auth ]]; then
    echo "Xvfb ${display:-?} $(owner "$user") -auth $(home "$auth"), which does not exist"
  elif read -r amode auser < <(stat -c '%a %U' "$auth" 2>/dev/null) && [[ -n ${auser:-} ]]; then
    echo "Xvfb ${display:-?} $(owner "$user") -auth $(home "$auth"), mode 0$amode, owner $(owner "$auser")"
  else
    failed "Xvfb ${display:-?}'s -auth file's mode and owner (stat)"
  fi
done

if ((unread)); then
  echo "FAIL $unread read(s) failed and $flags flag(s): the inventory is incomplete"
  exit 1
fi
if ((flags)); then
  echo "FAIL $flags flag(s)"
  exit 1
fi
echo "PASS no flags"
