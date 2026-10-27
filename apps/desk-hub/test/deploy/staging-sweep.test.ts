// The throwaway run's sweep (deploy/staging-sweep.py, O11 M8): what it deletes from the account after a staging run
// under a throwaway org. Offline: the sweep runs whole, its only network call (urllib's urlopen) answered by a fake of
// the Access API's list and delete calls, so every DELETE it would issue is seen here and none leaves the machine.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accessPlan } from '../../deploy/access.ts';
import { STAGING_HOST, STAGING_WORKER } from '../../deploy/config.ts';

const sweep = join(import.meta.dirname, '../../deploy/staging-sweep.py');
const python = spawnSync('python3', ['-c', 'pass']).status === 0;

// Runs the script as `sweep` against an account holding `now`, compared with the snapshot `before`; the requests it made.
const HARNESS = `
import io, json, runpy, sys, urllib.parse, urllib.request
script, scenario_file, result_file = sys.argv[1:4]
scenario = json.load(open(scenario_file))
calls = []
class Answer(io.BytesIO):
    pass
def urlopen(req, timeout=None):
    url = urllib.parse.urlparse(req.full_url)
    calls.append(f'{req.get_method()} {url.path}')
    if req.get_method() == 'GET':
        kind = url.path.rstrip('/').split('/')[-1]
        return Answer(json.dumps({'success': True, 'result': scenario['now'][kind], 'result_info': {'total_pages': 1}}).encode())
    return Answer(json.dumps({'success': True, 'result': {}}).encode())
urllib.request.urlopen = urlopen
sys.argv = [script, 'sweep', 'acct', scenario['before_file'], scenario['org'], scenario['out_file']]
sys.stdin = io.StringIO('fake-token\\n')
code = 0
try:
    runpy.run_path(script, run_name='__main__')
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else 1
json.dump({'code': code, 'deletes': [c for c in calls if c.startswith('DELETE')]}, open(result_file, 'w'))
`;

type Row = { id: string; name: string };
type Account = { service_tokens: Row[]; apps: Row[]; policies: Row[] };

function runSweep(before: Account, now: Account, org = 'staging-probe-t1'): { code: number; deletes: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'staging-sweep-'));
  const beforeFile = join(dir, 'before.json');
  writeFileSync(beforeFile, JSON.stringify(before));
  const scenario = join(dir, 'scenario.json');
  writeFileSync(scenario, JSON.stringify({ now, org, before_file: beforeFile, out_file: join(dir, 'out.json') }));
  const result = join(dir, 'result.json');
  const run = spawnSync('python3', ['-B', '-I', '-c', HARNESS, sweep, scenario, result], { encoding: 'utf8' });
  expect(run.stderr).not.toMatch(/Traceback/);
  return JSON.parse(readFileSync(result, 'utf8')) as { code: number; deletes: string[] };
}

const rows = (names: string[], prefix: string) => names.map((name, i) => ({ id: `${prefix}-${i}`, name }));
const none: Account = { service_tokens: [], apps: [], policies: [] };
// What the deploy tool makes on the staging Worker: its applications and reusable policies, by name.
const plan = accessPlan({ name: STAGING_WORKER, host: STAGING_HOST, ownerEmail: 'owner@example.com', sessionDuration: '24h' });

describe.skipIf(!python)('the sweep after a throwaway run', () => {
  it('deletes the Access applications and policies the deploy tool makes on staging, when they appeared', () => {
    const now = { service_tokens: [], apps: rows(plan.apps.map((a) => a.name), 'app'), policies: rows(plan.policies.map((p) => p.name), 'pol') };
    const swept = runSweep(none, now);
    expect(swept.code).toBe(0);
    expect(swept.deletes.sort()).toEqual([...now.apps.map((r) => `DELETE /client/v4/accounts/acct/access/apps/${r.id}`), ...now.policies.map((r) => `DELETE /client/v4/accounts/acct/access/policies/${r.id}`)].sort());
  });

  it('leaves any other desk-hub-staging* name alone, a production preview alias’s above all, and fails', () => {
    // wrangler names a version's preview alias `<alias>-<worker>`: `desk-hub-staging-desk-hub` is one of production's.
    const lookalikes = ['desk-hub-staging-desk-hub', 'desk-hub-staging-desk-hub owner', 'desk-hub-staging-desk-hub public paths', 'desk-hub-staging2', 'desk-hub-staging owner2'];
    const swept = runSweep(none, { service_tokens: [], apps: rows(lookalikes, 'app'), policies: rows(lookalikes, 'pol') });
    expect(swept.deletes).toEqual([]);
    expect(swept.code).toBe(3);
  });

  it('never deletes what was there before the run', () => {
    const account = { service_tokens: [], apps: rows(plan.apps.map((a) => a.name), 'app'), policies: rows(plan.policies.map((p) => p.name), 'pol') };
    const swept = runSweep(account, account);
    expect(swept).toEqual({ code: 0, deletes: [] });
  });
});
