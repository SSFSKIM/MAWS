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
#
# P5 O18 M6's reach scenes (RUN=o18, set by reach-acceptance.ts's composer with COMMIT, BUNDLE, BUNDLE_SHA256,
# SMINOS_NEW, SMINOS_OLD and the pinned Node, NODE_PIN, NODE_SHA256_X64 and NODE_SHA256_ARM64) are set up by reach_setup below instead, and need no MAWS checkout on the VM: the branch
# comes as a full bundle, staged at $BUNDLE by the steps before this one, and sminos as the run's own copies by commit
# (`git archive <commit> sminos`, sminos-new.tar and sminos-old.tar in the stage), never the VM's marketplace's. P5 O8
# M6b adds lane-b.mjs and a marketplace of the new sminos, for a lane B session on A1.
set -euo pipefail
say() { printf '%s\n' "$*"; }

# The branch built as user $1 from the clone at $2 (checked out at $COMMIT), packed into $3, on the Node in $4; prints
# the pack's path.
build_pack() {
  local u=$1 clone=$2 out=$3 nodebin=$4 h
  h=$(getent passwd "$u" | cut -d: -f6)
  runuser -u "$u" -- env -i HOME="$h" USER="$u" PATH="$nodebin:/usr/bin:/bin" LANG=C.UTF-8 ELECTRON_SKIP_BINARY_DOWNLOAD=1 OUT="$out" CLONE="$clone" bash -c '
    set -euo pipefail
    cd "$CLONE"
    v=$(node -p "require(\"./package.json\").packageManager.replace(/^pnpm@/, \"\")")
    [[ -x ~/.local/bin/pnpm ]] || npm install --global --prefix ~/.local "pnpm@$v" >/dev/null
    export PATH=$HOME/.local/bin:$PATH
    pnpm install --frozen-lockfile >~/build/install.log 2>&1 || { tail -20 ~/build/install.log; exit 1; }
    pnpm --silent mawsd:pack --out "$OUT" 2>~/build/pack.log | tail -n 1
  '
}

# What the reach scenes need of a VM created without the MAWS project (so no devenv step ran on it), which devcloud's
# image carries (its image/packages.sh: the apt part and Node LTS): any missing apt package installed from Ubuntu's
# archive, and a Node below MAWS's floor (22.12) or none replaced, for the build alone, by mawsd's pinned Node
# (packaging/mawsd/node.json, its sha256 checked), unpacked under /opt/o18-m6/node. pnpm is installed by build_pack
# at the version package.json's packageManager pins. Prints the Node bin directory the build runs on.
reach_prereqs() {
  local O=$1 have=() missing=() pkg cmd v arch sum
  for pair in git:git tmux:tmux python3:python3 make:build-essential g++:build-essential curl:curl ss:iproute2 pgrep:procps nsenter:util-linux unshare:util-linux runuser:util-linux setsid:util-linux sha256sum:coreutils tar:tar; do
    cmd=${pair%%:*} pkg=${pair#*:}
    command -v "$cmd" >/dev/null || [[ " ${missing[*]} " == *" $pkg "* ]] || missing+=("$pkg")
  done
  if ((${#missing[@]})); then
    say "setup: installing ${missing[*]} from Ubuntu's archive" >&2
    DEBIAN_FRONTEND=noninteractive apt-get update -q >&2 && DEBIAN_FRONTEND=noninteractive apt-get install -yq --no-install-recommends "${missing[@]}" >&2 || { say "setup: apt could not install ${missing[*]}" >&2; return 1; }
  fi
  v=$(node -p 'process.versions.node' 2>/dev/null || true)
  if [[ -n $v ]] && node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'; then
    have=("$(dirname "$(command -v node)")")
  else
    case $(uname -m) in x86_64) arch=x64 sum=$NODE_SHA256_X64 ;; aarch64) arch=arm64 sum=$NODE_SHA256_ARM64 ;; *) say "setup: no pinned Node for $(uname -m)" >&2; return 1 ;; esac
    [[ ${NODE_PIN:-} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $sum =~ ^[0-9a-f]{64}$ ]] || { say "setup: the composer gave no pinned Node" >&2; return 1; }
    if [[ ! -x $O/node/bin/node || $($O/node/bin/node -p 'process.versions.node') != "$NODE_PIN" ]]; then
      say "setup: Node ${v:-absent} is below MAWS's floor 22.12: the pinned $NODE_PIN for the build" >&2
      curl -q -fsSL --max-time 300 -o $O/node.tar.gz "https://nodejs.org/dist/v$NODE_PIN/node-v$NODE_PIN-linux-$arch.tar.gz" || { say "setup: the pinned Node did not download" >&2; return 1; }
      [[ $(sha256sum $O/node.tar.gz | cut -d' ' -f1) == "$sum" ]] || { rm -f $O/node.tar.gz; say "setup: the downloaded Node is not the pinned one (sha256)" >&2; return 1; }
      rm -rf $O/node && mkdir -p $O/node && tar -xzf $O/node.tar.gz -C $O/node --strip-components=1 && rm -f $O/node.tar.gz && chmod -R a+rX $O/node
    fi
    have=("$O/node/bin")
  fi
  say "${have[0]}"
}

reach_setup() {
  local O=/opt/o18-m6 A=/srv/o18-archive.git G=o18arch B=o18a1 u sc engine pack nodebin
  [[ ${COMMIT:-} =~ ^[0-9a-f]{40}$ && ${BUNDLE_SHA256:-} =~ ^[0-9a-f]{64}$ && ${SMINOS_NEW:-} =~ ^[0-9a-f]{40}$ && ${SMINOS_OLD:-} =~ ^[0-9a-f]{40}$ ]] || { say "setup: COMMIT, BUNDLE_SHA256, SMINOS_NEW and SMINOS_OLD are the composer's"; exit 2; }
  install -d -m 755 $O $O/bin
  nodebin=$(reach_prereqs $O) || exit 3
  say "build on node $("$nodebin/node" --version) ($nodebin)"
  [[ ${BUNDLE:-} == /var/tmp/o18-m6-stage/maws.bundle && -s $BUNDLE ]] || { say "setup: no staged bundle at ${BUNDLE:-?}"; exit 2; }
  for f in scene.sh stub-model.mjs stub-api.mjs lane-b.mjs sminos-new.tar sminos-old.tar; do [[ -s $STAGE/$f ]] || { say "setup: no $f in the stage"; exit 2; }; done
  [[ $(sha256sum "$BUNDLE" | cut -d' ' -f1) == "$BUNDLE_SHA256" ]] || { say "setup: the staged bundle is not the one sent (sha256)"; exit 3; }

  # The users, one a scene, and the archive's group, which they alone share.
  getent group $G >/dev/null || { groupadd $G; say "group $G made"; }
  for u in o18a1 o18a2 o18b o18a3; do
    if ! id $u >/dev/null 2>&1; then useradd -m -s /bin/bash -U -G $G $u; say "user $u made"; else usermod -a -G $G $u; say "user $u present"; fi
    chmod 700 /home/$u
    runuser -u $u -- test -r /Users/new/.config 2>/dev/null && { say "setup: $u can read the owner's home: stop"; exit 3; }
  done

  # The scenes' shared files.
  install -m 755 $STAGE/scene.sh $O/scene.sh
  install -m 644 $STAGE/stub-model.mjs $STAGE/stub-api.mjs $STAGE/lane-b.mjs $O/
  for sc in new old; do
    rm -rf $O/sminos-$sc.x && mkdir -p $O/sminos-$sc.x
    tar -x -f $STAGE/sminos-$sc.tar -C $O/sminos-$sc.x
    [[ -f $O/sminos-$sc.x/sminos/.claude-plugin/plugin.json ]] || { say "setup: sminos-$sc.tar holds no sminos plugin"; exit 3; }
    rm -rf $O/sminos-$sc && mv $O/sminos-$sc.x/sminos $O/sminos-$sc && rm -rf $O/sminos-$sc.x && chmod -R a+rX $O/sminos-$sc
  done
  say "sminos new $(grep -m1 '"version"' $O/sminos-new/.claude-plugin/plugin.json | tr -d ' ,') at ${SMINOS_NEW:0:12}, old $(grep -m1 '"version"' $O/sminos-old/.claude-plugin/plugin.json | tr -d ' ,') at ${SMINOS_OLD:0:12}: the run's copies"
  # P5 O8 M6b: lane B's, for A1's lane B session (scene.sh's lane-b-up): the new sminos in a directory marketplace of the
  # scenes' own, under the name lane-b-up installs from (`sminos@o10-m11`), as O10's scene keeps one.
  rm -rf $O/market && mkdir -p $O/market/.claude-plugin && cp -R $O/sminos-new $O/market/sminos
  printf '%s\n' '{"name": "o10-m11", "owner": {"name": "o10-m11"}, "plugins": [{"name": "sminos", "source": "./sminos", "description": "sminos, for the lane B session of the scene"}]}' > $O/market/.claude-plugin/marketplace.json
  chmod -R a+rX $O/market
  # The image's `claude` (devcloud links it at /usr/local/bin/claude): the binary itself, never the owner's config.
  engine=$(readlink -f /usr/local/bin/claude 2>/dev/null || readlink -f /Users/new/.local/bin/claude 2>/dev/null || true)
  [[ -n $engine && -x $engine ]] || { say "setup: no claude binary on the VM"; exit 3; }
  install -m 755 "$engine" $O/bin/claude
  say "claude $($O/bin/claude --version 2>/dev/null | head -1) copied (run only in the scenes, against the stub)"

  # The archive: a bare repository the scenes' group writes, root its owner.
  if [[ ! -d $A ]]; then
    git init -q --bare --shared=group -b main $A
    chgrp -R $G $A && chmod -R g+rwX $A && find $A -type d -exec chmod g+s {} +
    say "archive $A made (group $G)"
  else say "archive $A present"; fi

  # The branch, cloned from the bundle and built once as $B; the pack under $O, which every scene reads (homes are 0700).
  install -d -m 700 -o $B -g $B /home/$B/build
  rm -rf /home/$B/build/maws
  install -m 644 "$BUNDLE" /home/$B/build/maws.bundle
  chown $B:$B /home/$B/build/maws.bundle
  runuser -u $B -- bash -c "cd ~/build && git clone -q --no-checkout maws.bundle maws && cd maws && git -c advice.detachedHead=false checkout -q --detach $COMMIT"
  rm -f /home/$B/build/maws.bundle "$BUNDLE"
  say "branch at $(runuser -u $B -- git -C /home/$B/build/maws log --oneline -1)"
  install -d -m 755 -o $B -g $B $O/packs
  pack=$(build_pack $B /home/$B/build/maws $O/packs "$nodebin") || { say "setup: the build failed"; exit 4; }
  [[ -x $pack/runtime/bin/node && -f $pack/out/main/mawsd.js ]] || { say "setup: no pack at '$pack'"; exit 4; }
  chown -R root:root $O/packs && chmod -R a+rX,go-w $O/packs
  ln -sfn "$pack" $O/pack
  say "pack $(basename "$pack"): node $($pack/runtime/bin/node --version)"
  for sc in a1 a2 b1 a3; do say "-- scene $sc"; $O/scene.sh --scene $sc check; done
}

if [[ ${RUN:-} == o18 ]]; then reach_setup; exit 0; fi

U=o10acc
H=/home/$U
O=/opt/o10-m11
MAWS=/Users/new/Developer/GitHub/MAWS
MARKET=/var/lib/devcloud/marketplaces/doperpowers/sminos

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
