# shellcheck shell=bash
# The endpoint acceptance scene's teardown on the devcloud acceptance VM (P5 O10 M11), run as root when the live runs
# are over: the scene ended (scene.sh down), the scratch user and its home removed, /opt/o10-m11 removed, and a check
# that none of it remains. It touches nothing else: not the VM's own mawsd, its profile, or the owner's sminos.
#
# P5 O18 M6's reach scenes (RUN=o18, set by reach-acceptance.ts's composer): every scene ended (scene.sh --scene <s>
# down), the four scene users and their homes removed, the archive's group and bare repository, /opt/o18-m6 and the
# staged bundle removed, and a check that none of it remains and no scene port has a listener.
set -uo pipefail
say() { printf '%s\n' "$*"; }
left=0
if [[ ${RUN:-} == o18 ]]; then
  for sc in a1 a2 b1 a3; do [[ -x /opt/o18-m6/scene.sh ]] && /opt/o18-m6/scene.sh --scene $sc down; done
  for u in o18a1 o18a2 o18b o18a3; do
    if id $u >/dev/null 2>&1; then
      pkill -KILL -u $u 2>/dev/null
      sleep 1
      userdel -r $u 2>/dev/null || { say "LEFT the user $u (userdel failed)"; left=1; }
    fi
    rm -rf "/tmp/tmux-$(id -u $u 2>/dev/null || echo none)"
  done
  getent group o18arch >/dev/null && { groupdel o18arch 2>/dev/null || { say "LEFT the group o18arch"; left=1; }; }
  rm -rf /opt/o18-m6 /srv/o18-archive.git /var/tmp/o18-m6-stage /tmp/o18-m6-* /run/o18-a1-verbs /run/o18-a2-verbs /run/o18-b1-verbs /run/o18-a3-verbs
  for u in o18a1 o18a2 o18b o18a3; do
    id $u >/dev/null 2>&1 && { say "LEFT the user $u"; left=1; }
    [[ -e /home/$u ]] && { say "LEFT /home/$u"; left=1; }
  done
  for path in /opt/o18-m6 /srv/o18-archive.git /var/tmp/o18-m6-stage; do [[ -e $path ]] && { say "LEFT $path"; left=1; }; done
  for port in 47841 47842 47843 47844 47901 47902 47903 47904; do
    [[ $(ss -ltnH "( sport = :$port )" | wc -l) != 0 ]] && { say "LEFT a listener on port $port"; left=1; }
  done
  ((left == 0)) && say "teardown: the reach scenes' users, homes and group, /opt/o18-m6, the archive and the staged bundle are gone; nothing listens on the scenes' ports"
  exit $left
fi
U=o10acc
[[ -x /opt/o10-m11/scene.sh ]] && /opt/o10-m11/scene.sh down
if id $U >/dev/null 2>&1; then
  pkill -KILL -u $U 2>/dev/null
  sleep 1
  userdel -r $U 2>/dev/null || { say "LEFT the user $U (userdel failed)"; left=1; }
fi
rm -rf /opt/o10-m11 /tmp/o10-m11-* "/tmp/tmux-$(id -u $U 2>/dev/null || echo none)"
id $U >/dev/null 2>&1 && { say "LEFT the user $U"; left=1; }
[[ -e /home/$U ]] && { say "LEFT /home/$U"; left=1; }
[[ -e /opt/o10-m11 ]] && { say "LEFT /opt/o10-m11"; left=1; }
[[ $(ss -ltnH '( sport = :47831 )' | wc -l) != 0 ]] && { say "LEFT a listener on port 47831"; left=1; }
((left == 0)) && say "teardown: the scratch user, its home and /opt/o10-m11 are gone; nothing listens on 47831"
exit $left
