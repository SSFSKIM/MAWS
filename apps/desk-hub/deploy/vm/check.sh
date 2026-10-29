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
