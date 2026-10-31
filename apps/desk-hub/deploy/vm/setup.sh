# shellcheck shell=bash
# The endpoint acceptance scene's setup on the devcloud acceptance VM (P5 O10 M11), run as root once before the live
# runs, and again after the branch moves (it rebuilds; safe to re-run). It is the body of a composed script
# (endpoint-machine.ts's composeScript; `deployment endpoint-acceptance --vm-setup`), whose stage directory $STAGE holds
# scene.sh, production.sh, stub-model.mjs, stub-api.mjs (spikes/protocol-probe's), lane-b.mjs and maws.bundle (the branch, from
# $BASE, a commit the VM's MAWS checkout holds), and which sets BASE and COMMIT before this. It makes:
#   - the scratch user o10acc (home 0700: the owner's home is 0750, so the user reads nothing of the owner's);
#   - /opt/o10-m11: scene.sh, the stub model, lane B's machine.sock client, a copy of the sminos plugin (the devcloud
#     marketplace's, world-readable) and a directory marketplace holding another (`market/`, which lane B's engine installs
#     from, as a MAWS session loads the user scope's plugins), and of the VM's own `claude` binary, which the scene runs
#     with no credential against the stub;
#   - ~o10acc/pack: `mawsd` packed from the branch (pnpm mawsd:pack, as devenv/setup.sh does on Linux), built as o10acc
#     from a clone of the VM's MAWS checkout with the bundle fetched on top.
# It starts nothing and enrolls nothing; it never touches the VM's own mawsd, its profile, or the owner's sminos.
set -euo pipefail
U=o10acc
H=/home/$U
O=/opt/o10-m11
MAWS=/Users/new/Developer/GitHub/MAWS
MARKET=/var/lib/devcloud/marketplaces/doperpowers/sminos
say() { printf '%s\n' "$*"; }

[[ ${BASE:-} =~ ^[0-9a-f]{40}$ && ${COMMIT:-} =~ ^[0-9a-f]{40}$ ]] || { say "setup: BASE and COMMIT are the composer's, full commit ids"; exit 2; }
for f in scene.sh production.sh stub-model.mjs stub-api.mjs lane-b.mjs maws.bundle; do [[ -s $STAGE/$f ]] || { say "setup: no $f in the stage"; exit 2; }; done

# The user.
if ! id $U >/dev/null 2>&1; then useradd -m -s /bin/bash -U $U; say "user $U made"; else say "user $U present"; fi
chmod 700 $H
runuser -u $U -- test -r /Users/new/.config 2>/dev/null && { say "setup: $U can read the owner's home: stop"; exit 3; }

# The scene's files.
install -d -m 755 $O $O/bin
install -m 755 $STAGE/scene.sh $O/scene.sh
install -m 755 $STAGE/production.sh $O/production.sh   # production's driver (part 2); nothing runs it here
install -m 644 $STAGE/stub-model.mjs $STAGE/stub-api.mjs $STAGE/lane-b.mjs $O/
rm -rf $O/sminos.new && mkdir -p $O/sminos.new
for part in .claude-plugin hooks skills types; do [[ -e $MARKET/$part ]] && cp -R $MARKET/$part $O/sminos.new/; done
rm -rf $O/sminos && mv $O/sminos.new $O/sminos && chmod -R a+rX $O/sminos
ln -sfn $O/sminos/skills/sminos/scripts/sminos $O/bin/sminos
say "sminos $(grep -m1 '"version"' $O/sminos/.claude-plugin/plugin.json | tr -d ' ,') copied from the devcloud marketplace"
# Lane B's: the same copy in a directory marketplace of the scene's own (`sminos@o10-m11`).
rm -rf $O/market && mkdir -p $O/market/.claude-plugin && cp -R $O/sminos $O/market/sminos
printf '%s\n' '{"name": "o10-m11", "owner": {"name": "o10-m11"}, "plugins": [{"name": "sminos", "source": "./sminos", "description": "sminos, for the lane B session of the scene"}]}' > $O/market/.claude-plugin/marketplace.json
chmod -R a+rX $O/market
engine=$(readlink -f /Users/new/.local/bin/claude)
[[ -x $engine ]] || { say "setup: no claude binary on the VM"; exit 3; }
install -m 755 "$engine" $O/bin/claude
say "claude $($O/bin/claude --version 2>/dev/null | head -1) copied (run only in the scene, against the stub)"

# The branch, built as o10acc.
install -d -m 700 -o $U -g $U $H/build
rm -rf $H/build/maws
printf '[safe]\n\tdirectory = *\n' > $STAGE/gitconfig
GIT_CONFIG_GLOBAL=$STAGE/gitconfig git clone -q --no-local --no-checkout $MAWS $H/build/maws
git -C $H/build/maws cat-file -e "$BASE^{commit}" || { say "setup: the VM's checkout lacks the bundle's base $BASE"; exit 3; }
install -m 600 $STAGE/maws.bundle $H/build/maws.bundle
chown -R $U:$U $H/build
runuser -u $U -- bash -c "cd $H/build/maws && git fetch -q $H/build/maws.bundle $COMMIT && git -c advice.detachedHead=false checkout -q --detach $COMMIT"
say "branch at $(runuser -u $U -- git -C $H/build/maws log --oneline -1)"
pack=$(runuser -u $U -- env -i HOME=$H USER=$U PATH=/usr/bin:/bin LANG=C.UTF-8 ELECTRON_SKIP_BINARY_DOWNLOAD=1 bash -c '
  set -euo pipefail
  cd ~/build/maws
  v=$(node -p "require(\"./package.json\").packageManager.replace(/^pnpm@/, \"\")")
  [[ -x ~/.local/bin/pnpm ]] || npm install --global --prefix ~/.local "pnpm@$v" >/dev/null
  export PATH=$HOME/.local/bin:$PATH
  pnpm install --frozen-lockfile >~/build/install.log 2>&1 || { tail -20 ~/build/install.log; exit 1; }
  pnpm --silent mawsd:pack --out ~/packs 2>~/build/pack.log | tail -n 1
') || { say "setup: the build failed"; exit 4; }
[[ -x $pack/runtime/bin/node && -f $pack/out/main/mawsd.js ]] || { say "setup: no pack at '$pack'"; exit 4; }
ln -sfn "$pack" $H/pack && chown -h $U:$U $H/pack
say "pack $(basename "$pack"): node $($pack/runtime/bin/node --version)"
$O/scene.sh check
