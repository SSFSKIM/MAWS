#!/usr/bin/env bash
# Fetch the publisher's release, first via the web route, then the API asset route.
# Callers own checksum verification. Never replace dest with a partial download.
set +x
set -euo pipefail
(($# == 4)) || { echo 'usage: release-fetch.sh <owner/repo> <tag> <asset-name> <dest>' >&2; exit 2; }
repo=$1 tag=$2 asset=$3 dest=$4
mkdir -p "$(dirname "$dest")"
work=$(mktemp -d "${dest}.fetch.XXXXXX")
trap 'rm -rf "$work"' EXIT
# Bound each attempt and retries. Keep curl diagnostics private: authenticated failures
# must not print credentials, even if a proxy reflects a request header in its error.
fetch() { curl -fsSL --retry 2 --retry-max-time 30 --connect-timeout 20 --max-time 180 "$@" 2>"$work/curl-error"; }
# Release names can contain URL metacharacters (notably tags with slashes).
encode() { python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
tag_path=$(encode "$tag")
asset_path=$(encode "$asset")
web=https://github.com/$repo/releases/download/$tag_path/$asset_path
if fetch -o "$work/asset" "$web"; then
  mv -f "$work/asset" "$dest"
  exit 0
else
  web_status=$?
fi
fail() {
  echo "release-fetch: web download failed (curl $web_status): $web; API $1 failed for $repo $tag $asset" >&2
  exit 1
}
headers=('X-GitHub-Api-Version: 2022-11-28')
token=${GH_TOKEN:-${GITHUB_TOKEN:-}}
[[ -z $token ]] || headers+=("Authorization: Bearer $token")
# curl reads these headers from stdin, never argv (visible in process listings). A here-string, not a pipe: the shell
# writes it before curl starts, so a curl that exits without reading stdin can't fail the call under pipefail through
# printf's SIGPIPE (mawsd-pack.test.mjs's fake curl, static on run 42475844068).
api_fetch() { fetch -H @- "$@" <<<"$(printf '%s\n' "${headers[@]}")"; }
api=https://api.github.com/repos/$repo/releases
api_fetch -H 'Accept: application/vnd.github+json' -o "$work/release.json" "$api/tags/$tag_path" || fail 'release lookup'
id=$(python3 -I - "$work/release.json" "$asset" <<'PY'
import json, sys
assets = json.load(open(sys.argv[1]))['assets']
ids = [a['id'] for a in assets if a['name'] == sys.argv[2]]
if len(ids) != 1 or type(ids[0]) is not int or ids[0] <= 0:
    sys.exit(1)
print(ids[0])
PY
) 2>/dev/null || fail 'asset lookup'
api_fetch -H 'Accept: application/octet-stream' -o "$work/asset" "$api/assets/$id" || fail 'asset download'
mv -f "$work/asset" "$dest"
