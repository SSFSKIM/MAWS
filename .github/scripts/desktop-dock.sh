#!/usr/bin/env bash
# The Mac desktop facts a window's size rests on, as the job that runs this sees them: whether the Dock hides itself, and
# the main screen's visible frame, its frame less the menu bar and a shown Dock (points, origin at the bottom left, as
# AppKit gives it). The display's mode is ci-kit's own desktop line on its self-hosted Macs, and the hosted Macs' setup
# step's. Reads only, and exits 0: a fact it cannot read is `unknown`. Prints one line:
#   dock autohide <on|off|unknown> visible <w>x<h> at <x>,<y> of <w>x<h>
# --wait <seconds>: first reads again, every half second up to that bound, until the visible frame is all of the screen
# but its menu bar (within 40 points of the frame's height), for a Dock just told to hide itself.
set -uo pipefail

case $(defaults read com.apple.dock autohide 2>/dev/null) in
  1) dock=on ;;
  0 | '') dock=off ;; # an unset key is the default, a shown Dock
  *) dock=unknown ;;
esac

frames() {
  osascript -l JavaScript -e 'ObjC.import("AppKit"); const s = $.NSScreen.mainScreen; const f = s.frame, v = s.visibleFrame;
    [f.size.width, f.size.height, v.size.width, v.size.height, v.origin.x, v.origin.y].map(Math.round).join(" ")' 2>/dev/null
}
read_frames() {
  read -r fw fh vw vh vx vy <<<"$(frames)" || true
  [[ ${fw-} =~ ^[0-9]+$ && ${fh-} =~ ^[0-9]+$ && ${vw-} =~ ^[0-9]+$ && ${vh-} =~ ^[0-9]+$ && ${vx-} =~ ^-?[0-9]+$ && ${vy-} =~ ^-?[0-9]+$ ]]
}

ok=false
if read_frames; then ok=true; fi
if $ok && [[ ${1:-} == --wait ]]; then
  for ((tries = ${2:-10} * 2; tries > 0 && vh < fh - 40; tries--)); do
    sleep 0.5
    if ! read_frames; then ok=false; break; fi
  done
fi
if $ok; then visible="${vw}x${vh} at ${vx},${vy} of ${fw}x${fh}"; else visible=unknown; fi
echo "dock autohide $dock visible $visible"
