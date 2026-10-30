# shellcheck shell=bash
# The endpoint acceptance scene's teardown on the devcloud acceptance VM (P5 O10 M11), run as root when the live runs
# are over: the scene ended (scene.sh down), the scratch user and its home removed, /opt/o10-m11 removed, and a check
# that none of it remains. It touches nothing else: not the VM's own mawsd, its profile, or the owner's sminos.
set -uo pipefail
U=o10acc
say() { printf '%s\n' "$*"; }
left=0
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
