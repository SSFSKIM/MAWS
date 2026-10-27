"""What a throwaway staging run leaves on the Cloudflare account, and its removal (staging-run.sh's `throwaway`).

A deploy of staging under a throwaway org (staging-probe-*) can make Access objects and service tokens for that org.
`snapshot` records the account before the run; `sweep` compares after it and deletes what appeared and is the throwaway
org's. Records names and ids only. The Access setup token is read from stdin (one line), never printed or written.

  snapshot <account> <file>              every service token, and every Access app and reusable policy named desk-hub*
  sweep <account> <before> <org> <out>   compares with <before>; deletes what appeared and is the throwaway org's:
                                         service tokens named desk-<org>-* or desk-probe-unenrolled-*, and the Access
                                         apps, then policies, the deploy tool makes on staging (STAGING_APPS and
                                         STAGING_POLICIES, by exact name). Anything else that appeared is left
                                         untouched and makes the sweep fail (exit 3). <out> records what it found and
                                         deleted.

Production is refused by name before anything is read: the org must be a staging-probe-* one, and no object of
production's (named in PRODUCTION_NAMES, or the production org's service tokens) is ever deleted, whatever appeared.

Run as: <token on stdin> python3 -B -I staging-sweep.py <mode> ...
"""

import json
import sys
import urllib.error
import urllib.request

API = 'https://api.cloudflare.com/client/v4'
THROWAWAY_PREFIX = 'staging-probe-'
# The Access objects the deploy tool makes on the staging Worker (deploy/access.ts's accessPlan for STAGING_WORKER in
# deploy/config.ts), by exact name. Not a prefix: wrangler names a version's preview alias `<alias>-<worker>`, so
# `desk-hub-staging-desk-hub` is one of production's, and its Access objects would carry that name.
STAGING_WORKER = 'desk-hub-staging'
STAGING_APPS = (STAGING_WORKER, f'{STAGING_WORKER} public paths')
STAGING_POLICIES = (f'{STAGING_WORKER} owner', f'{STAGING_WORKER} machines', f'{STAGING_WORKER} public paths')
# Production's Worker and its Access apps, and its org's service tokens: never deleted.
PRODUCTION_NAMES = ('desk-hub', 'desk-hub public paths')
PRODUCTION_TOKEN_PREFIX = 'desk-ssfskim-'


def call(token, method, path):
    req = urllib.request.Request(f'{API}{path}', method=method, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            errors = json.load(e).get('errors', [])
        except ValueError:
            errors = []
        sys.exit(f'{method} {path}: {e.code} ' + '; '.join(f"{x.get('code')} {x.get('message')}" for x in errors))


def listed(token, path):
    out, page = [], 1
    while True:
        body = call(token, 'GET', f'{path}?page={page}&per_page=50')
        out += body.get('result') or []
        if page >= (body.get('result_info') or {}).get('total_pages', 1):
            return out
        page += 1


def snapshot(token, account):
    base = f'/accounts/{account}/access'
    named = lambda rows, keep: sorted(({'id': r['id'], 'name': r.get('name') or ''} for r in rows if keep(r.get('name') or '')), key=lambda r: r['name'])
    return {
        'service_tokens': named(listed(token, f'{base}/service_tokens'), lambda n: True),
        'apps': named(listed(token, f'{base}/apps'), lambda n: n.startswith('desk-hub')),
        'policies': named(listed(token, f'{base}/policies'), lambda n: n.startswith('desk-hub')),
    }


def production(name):
    return name in PRODUCTION_NAMES or name.startswith(PRODUCTION_TOKEN_PREFIX)


def main():
    if len(sys.argv) < 4 or sys.argv[1] not in ('snapshot', 'sweep') or (sys.argv[1] == 'sweep' and len(sys.argv) != 6):
        sys.exit(__doc__)
    mode, account = sys.argv[1], sys.argv[2]
    if mode == 'sweep' and not sys.argv[4].startswith(THROWAWAY_PREFIX):
        sys.exit(f'{sys.argv[4]} is not a {THROWAWAY_PREFIX}* org: refusing to sweep')
    token = sys.stdin.readline().strip()
    if not token:
        sys.exit('no token on stdin')
    if mode == 'snapshot':
        with open(sys.argv[3], 'w') as f:
            json.dump(snapshot(token, account), f, indent=2)
        print('snapshot written')
        return
    before_file, org, out = sys.argv[3], sys.argv[4], sys.argv[5]
    with open(before_file) as f:
        before = json.load(f)
    now = snapshot(token, account)
    base = f'/accounts/{account}/access'
    report = {'org': org, 'appeared': {}, 'deleted': [], 'left_untouched': []}
    owned = {
        'service_tokens': lambda n: n.startswith(f'desk-{org}-') or n.startswith('desk-probe-unenrolled-'),
        'apps': lambda n: n in STAGING_APPS,
        'policies': lambda n: n in STAGING_POLICIES,
    }
    for kind in ('service_tokens', 'apps', 'policies'):  # apps before the policies they reference
        known = {r['id'] for r in before[kind]}
        appeared = [r for r in now[kind] if r['id'] not in known]
        report['appeared'][kind] = [r['name'] for r in appeared]
        for r in appeared:
            if owned[kind](r['name']) and not production(r['name']):
                call(token, 'DELETE', f'{base}/{kind}/{r["id"]}')
                report['deleted'].append(f'{kind}: {r["name"]}')
            else:
                report['left_untouched'].append(f'{kind}: {r["name"]}')
    with open(out, 'w') as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    if report['left_untouched']:
        sys.exit(3)


main()
