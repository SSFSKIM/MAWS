// fixB keychain conditions (a)(b)(c), pinned at the places e2e:discover reaches the login keychain from: the one
// `security` caller is the custody (e2e/support/connector-oauth.ts), every custody names its run's scratch root and the
// engine environment, the steps that run an engine under the runner's HOME are guarded, and none blocks the event loop
// (a synchronous engine or `security` call there would hold the prompt guard off until its own bound).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');
const e2eFiles = () => [...readdirSync(join(REPO, 'e2e')).filter((f) => f.endsWith('.ts')).map((f) => `e2e/${f}`), ...readdirSync(join(REPO, 'e2e/support')).filter((f) => /\.(ts|mts|mjs)$/.test(f)).map((f) => `e2e/support/${f}`)];

describe('the discover e2e’s keychain reach', () => {
  it('(a)(b) has one security caller, the custody, which never prints a password or attributes', () => {
    const callers = e2eFiles().filter((f) => /\/usr\/bin\/security|['"`]security['"`]\s*,/.test(read(f)));
    expect(callers).toEqual(['e2e/support/connector-oauth.ts']);
    for (const f of e2eFiles()) expect(read(f), f).not.toMatch(/generic-password['"`][^\n]*['"`]-[wg]['"`]/);
    expect(read('e2e/support/connector-oauth.ts')).toMatch(/run\(\[verb, '-s', name\]\)/);
  });

  it('(a) names no bare owner item to delete anywhere in the e2e', () => {
    for (const f of e2eFiles()) expect(read(f), f).not.toMatch(/['"`]Claude Code-credentials['"`]/);
  });

  it('(a)(b)(c) gives every custody in the discover spec its scratch root and engine environment, and guards its engine runs', () => {
    const spec = read('e2e/discover-connectors.spec.ts');
    const custodies = spec.match(/engineKeychainCustody\([^;]*;/g) ?? [];
    expect(custodies.length).toBeGreaterThanOrEqual(3);
    for (const call of custodies) expect(call).toMatch(/scratchRoot:[\s\S]*engineEnv:/);
    expect(spec).not.toMatch(/\b(execFileSync|spawnSync|execSync)\b/);
    expect(spec).toMatch(/guardKeychain\('the sign-in spike'/);
    expect(spec).toMatch(/guardKeychain\(`claude \$\{args\.join/);
    expect(spec).toMatch(/assertEngineProcessKeychainEnv\(pid, engine\.scratch\.configDir\)/);
  });

  it('(b)(c) has every real-engine launch on a Mac check the engine’s login-shell environment and watch for a prompt', () => {
    const launch = read('e2e/support/launch.ts');
    expect(launch).toMatch(/const keychainScene = Boolean\(opts\.realEngine\) && process\.platform === 'darwin'/);
    expect(launch).toMatch(/assertEngineKeychainEnv\(loginShellEnvironment\(env\), env\.CLAUDE_CONFIG_DIR!/);
    expect(launch).toMatch(/keychainWatch = watchKeychainPrompt\(\(\) => child\?\.pid !== undefined && killTree\(child\.pid\)\)/);
    expect(launch).toMatch(/if \(prompted\) throw prompted;/);
  });
});
