# shellcheck shell=bash
# The endpoint acceptance scene's read-only check on the devcloud acceptance VM (P5 O10 M11), run as root before
# setup.sh: what the scene needs and whether the VM has it. It writes nothing and reads nothing of the owner's beyond
# the existence of the files setup.sh copies (the `claude` binary, the MAWS checkout's head commit, which the branch's
# bundle is cut from) and the world-readable devcloud marketplace's sminos.
set -uo pipefail
say() { printf '%s\n' "$*"; }
MAWS=/Users/new/Developer/GitHub/MAWS
MARKET=/var/lib/devcloud/marketplaces/doperpowers/sminos
say "os: $(. /etc/os-release && echo "$PRETTY_NAME"), kernel $(uname -r), $(nproc) cpu, $(free -m | awk '/^Mem:/{print $2}') MiB, $(df -h / | awk 'NR==2{print $4}') free"
say "node: $(node --version 2>/dev/null || echo missing); npm: $(npm --version 2>/dev/null || echo missing); python3: $(python3 --version 2>&1)"
say "tools: $(for t in git tmux ss nsenter unshare runuser useradd curl make g++ jq; do command -v $t >/dev/null || printf 'missing-%s ' $t; done)ok"
say "ss -K: $(grep -q '^CONFIG_INET_DIAG_DESTROY=y' "/boot/config-$(uname -r)" 2>/dev/null && echo supported || echo unknown)"
say "checkout-head: $(git -c safe.directory=$MAWS -C $MAWS rev-parse HEAD 2>/dev/null || echo none)"
say "claude: $(f=$(readlink -f /Users/new/.local/bin/claude 2>/dev/null); [[ -x $f ]] && echo "$(basename "$f") present" || echo missing)"
say "sminos: $(grep -m1 '"version"' $MARKET/.claude-plugin/plugin.json 2>/dev/null | tr -d ' ,' || echo missing); readable by others: $(stat -c %A $MARKET 2>/dev/null)"
say "managed settings: $(ls /etc/claude-code 2>/dev/null | tr '\n' ' ')"
say "scratch user o10acc: $(id o10acc >/dev/null 2>&1 && echo present || echo absent)"
say "port 47831: $(ss -ltnH '( sport = :47831 )' | wc -l) listener(s); port 47899 (the stub): $(ss -ltnH '( sport = :47899 )' | wc -l)"
say "tailnet: $(ip -4 -o addr show tailscale0 2>/dev/null | awk '{print $4}') $(ip -6 -o addr show tailscale0 2>/dev/null | awk '$4 ~ /^fd7a/ {print $4}')"
say "nodejs.org: $(curl -q -s -o /dev/null -w '%{http_code}' --max-time 10 https://nodejs.org/dist/ 2>/dev/null); registry.npmjs.org: $(curl -q -s -o /dev/null -w '%{http_code}' --max-time 10 https://registry.npmjs.org/ 2>/dev/null)"
say "scene: $([[ -x /opt/o10-m11/scene.sh ]] && /opt/o10-m11/scene.sh check | tr '\n' ';' || echo 'not installed')"
# P5 O18 M6's reach scenes: what setup.sh's RUN=o18 needs of a VM created without the MAWS project (no checkout, no
# devenv step): Node at MAWS's floor (22.12; below it setup.sh unpacks mawsd's pinned Node for the build), the tools,
# devcloud's `claude`, and what of the scenes is there already.
say "reach node: $(node -e 'const [a, b] = process.versions.node.split(".").map(Number); console.log(process.version, a > 22 || (a === 22 && b >= 12) ? "(at the floor 22.12)" : "(below the floor 22.12: setup unpacks the pinned Node)")' 2>/dev/null || echo 'missing (setup unpacks the pinned Node)'); pnpm: $(command -v pnpm >/dev/null && pnpm --version || echo 'absent (setup installs the version package.json pins, per build)')"
say "reach tools: $(for t in git tmux python3 make g++ curl ss pgrep nsenter unshare runuser setsid sha256sum tar useradd groupadd getent; do command -v $t >/dev/null || printf 'missing-%s ' $t; done)ok (setup installs a missing one from Ubuntu's archive)"
say "reach python3: $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo missing)"
say "reach claude: $(f=$(readlink -f /usr/local/bin/claude 2>/dev/null); [[ -x $f ]] && echo "$(basename "$f") present" || echo missing)"
say "reach users: $(for u in o18a1 o18a2 o18b o18a3; do id $u >/dev/null 2>&1 && printf '%s ' $u; done)present; archive: $([[ -d /srv/o18-archive.git ]] && echo present || echo absent)"
say "reach ports: $(for p in 47841 47842 47843 47844 47901 47902 47903 47904; do printf '%s:%s ' $p "$(ss -ltnH "( sport = :$p )" | wc -l)"; done)(listeners)"
say "reach scenes: $([[ -x /opt/o18-m6/scene.sh ]] && for sc in a1 a2 b1 a3; do /opt/o18-m6/scene.sh --scene $sc check | tr '\n' ';'; done || echo 'not installed')"
