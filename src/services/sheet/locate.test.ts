// How MAWS finds the `sminos` it appends with (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md S2, §E):
// the executable MAWS_SMINOS_CLI names, or the `bin/sminos` of an enabled user-scope installation of the plugin, and
// never a project's or a disabled one, nor a `sminos` that is merely on a PATH; each found one proven once by its probe.
// Every executable here is a stub that records that it ran (FAKE_SMINOS_RAN), so a test can say which ran, or none.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { managedSettingsDir } from '../../engine-host/session-start-hooks';
import { locateSminos, type LocateDeps } from './locate';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-sheet-locate-'));
  scratch.push(dir);
  return dir;
};

// A stub `sminos` that appends its path to FAKE_SMINOS_RAN, says `stderr` and exits `code`.
function stub(path: string, code: number, stderr = ''): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho "$0" >> "$FAKE_SMINOS_RAN"\n${stderr ? `echo '${stderr}' >&2\n` : ''}exit ${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

interface Install {
  id: string;
  scope: 'user' | 'project' | 'local' | 'managed';
  projectPath?: string;
}

// A scratch machine: a config home with its plugin registry and user settings, a managed settings root, the sminos home.
function machine() {
  const root = tempDir();
  const configHome = join(root, 'config');
  const systemRoot = join(root, 'system');
  const ran = join(root, 'ran');
  mkdirSync(join(configHome, 'plugins'), { recursive: true });
  const registry: Record<string, unknown[]> = {};
  const installs: string[] = [];
  const write = () => writeFileSync(join(configHome, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: registry }));
  write();
  return {
    root,
    configHome,
    ranFile: ran,
    /** An installation of the plugin whose `bin/sminos` is a stub exiting `code`; answers that path. */
    install({ id, scope, projectPath }: Install, code = 3, stderr = ''): string {
      const installPath = join(root, 'cache', id.replace('@', '-'), `${installs.length}`);
      installs.push(installPath);
      (registry[id] ??= []).push({ scope, installPath, version: '1.0.0', ...(projectPath === undefined ? {} : { projectPath }) });
      write();
      return stub(join(installPath, 'bin', 'sminos'), code, stderr);
    },
    enable(settings: Record<string, boolean>, where: 'user' | 'managed' = 'user'): void {
      const dir = where === 'user' ? configHome : join(systemRoot, managedSettingsDir());
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, where === 'user' ? 'settings.json' : 'managed-settings.json'), JSON.stringify({ enabledPlugins: settings }));
    },
    deps(extra: Partial<LocateDeps> = {}): LocateDeps {
      return { env: {}, shell: { PATH: process.env.PATH ?? '', FAKE_SMINOS_RAN: ran }, configHome, home: join(root, 'sminos-home'), underTest: false, systemRoot, ...extra };
    },
    ran(): string[] {
      return existsSync(ran) ? readFileSync(ran, 'utf8').split('\n').filter(Boolean) : [];
    },
  };
}

describe('locateSminos: the sources', () => {
  it('takes the executable MAWS_SMINOS_CLI names, from MAWS’s own environment, then the login shell’s', async () => {
    const m = machine();
    const own = stub(join(m.root, 'own', 'sminos'), 3);
    const shells = stub(join(m.root, 'shells', 'sminos'), 3);
    const fromEnv = await locateSminos(m.deps({ env: { MAWS_SMINOS_CLI: own }, shell: { ...m.deps().shell, MAWS_SMINOS_CLI: shells } }));
    expect(fromEnv).toMatchObject({ ok: true, cli: { path: own, source: 'named' } });
    const fromShell = await locateSminos(m.deps({ shell: { ...m.deps().shell, MAWS_SMINOS_CLI: shells } }));
    expect(fromShell).toMatchObject({ ok: true, cli: { path: shells, source: 'named' } });
    expect(m.ran()).toEqual([own, shells]);
  });

  it('runs the found command under the login shell’s environment, with SMINOS_HOME the reader’s home', async () => {
    const m = machine();
    const own = stub(join(m.root, 'own', 'sminos'), 3);
    const located = await locateSminos(m.deps({ env: { MAWS_SMINOS_CLI: own }, shell: { ...m.deps().shell, SMINOS_HOME: '/elsewhere', EXTRA: 'x' } }));
    if (!located.ok) throw new Error(located.detail);
    expect(located.cli.env).toEqual({ ...m.deps().shell, EXTRA: 'x', SMINOS_HOME: m.deps().home });
  });

  it('takes the bin/sminos of an enabled user-scope installation of the plugin', async () => {
    const m = machine();
    const path = m.install({ id: 'sminos@doperpowers', scope: 'user' });
    m.enable({ 'sminos@doperpowers': true });
    expect(await locateSminos(m.deps())).toMatchObject({ ok: true, cli: { path, source: 'plugin' } });
    expect(m.ran()).toEqual([path]);
  });

  it('reads the enablement from managed settings too, which win over the user’s', async () => {
    const m = machine();
    const path = m.install({ id: 'sminos@doperpowers', scope: 'user' });
    m.enable({ 'sminos@doperpowers': true }, 'managed');
    expect(await locateSminos(m.deps())).toMatchObject({ ok: true, cli: { path } });
    m.enable({ 'sminos@doperpowers': true });
    m.enable({ 'sminos@doperpowers': false }, 'managed');
    expect(await locateSminos(m.deps())).toMatchObject({ ok: false, reason: 'not-installed' });
  });

  it('never takes a disabled installation, and runs nothing of it', async () => {
    const m = machine();
    m.install({ id: 'sminos@doperpowers', scope: 'user' });
    m.enable({ 'sminos@doperpowers': false });
    expect(await locateSminos(m.deps())).toMatchObject({ ok: false, reason: 'not-installed' });
    m.enable({});
    expect(await locateSminos(m.deps())).toMatchObject({ ok: false, reason: 'not-installed' });
    expect(m.ran()).toEqual([]);
  });

  it('never takes an installation of project or local scope, enabled or not, and runs neither', async () => {
    const m = machine();
    m.install({ id: 'sminos@doperpowers', scope: 'project', projectPath: join(m.root, 'project-a') });
    m.install({ id: 'sminos@doperpowers', scope: 'project', projectPath: join(m.root, 'project-b') });
    m.install({ id: 'sminos@other', scope: 'local', projectPath: join(m.root, 'project-a') });
    m.enable({ 'sminos@doperpowers': true, 'sminos@other': true });
    expect(await locateSminos(m.deps())).toMatchObject({ ok: false, reason: 'not-installed' });
    expect(m.ran()).toEqual([]);
  });

  it('never takes a sminos that is only on the PATH', async () => {
    const m = machine();
    const bin = join(m.root, 'path-bin');
    stub(join(bin, 'sminos'), 3);
    expect(await locateSminos(m.deps({ shell: { PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_SMINOS_RAN: m.ranFile } }))).toMatchObject({ ok: false, reason: 'not-installed' });
    expect(m.ran()).toEqual([]);
  });

  it('under a test runner reads only MAWS_SMINOS_CLI', async () => {
    const m = machine();
    m.install({ id: 'sminos@doperpowers', scope: 'user' });
    m.enable({ 'sminos@doperpowers': true });
    expect(await locateSminos(m.deps({ underTest: true }))).toMatchObject({ ok: false, reason: 'not-installed' });
    expect(m.ran()).toEqual([]);
    const own = stub(join(m.root, 'own', 'sminos'), 3);
    expect(await locateSminos(m.deps({ underTest: true, env: { MAWS_SMINOS_CLI: own } }))).toMatchObject({ ok: true, cli: { path: own } });
  });

  it('says why in a sentence that names no path', async () => {
    const m = machine();
    const located = await locateSminos(m.deps());
    expect(located).toMatchObject({ ok: false, reason: 'not-installed' });
    if (located.ok) return;
    expect(located.detail).not.toContain('/');
    expect(located.detail).not.toBe('');
  });
});

describe('locateSminos: the probe', () => {
  it('takes exit 3 (no sheet) as proof; a Python sminos complains of, or a command that cannot start, as not runnable; any other exit as no sheet verbs', async () => {
    const m = machine();
    const cases: [string, string, string][] = [
      ['ok', stub(join(m.root, 'a', 'sminos'), 3), ''],
      ['not-runnable', stub(join(m.root, 'b', 'sminos'), 1, 'sminos needs Python 3.10 or newer, and python3 is 3.9.'), ''],
      ['no-sheet-verbs', stub(join(m.root, 'c', 'sminos'), 2, 'usage: sminos ...'), ''],
      ['no-sheet-verbs', stub(join(m.root, 'd', 'sminos'), 1, 'something else went wrong'), ''],
    ];
    for (const [expected, path] of cases) {
      const located = await locateSminos(m.deps({ env: { MAWS_SMINOS_CLI: path } }));
      expect(located.ok ? 'ok' : located.reason, path).toBe(expected);
      if (!located.ok) expect(located.detail).not.toContain('/');
    }
    const notExecutable = join(m.root, 'e', 'sminos');
    mkdirSync(join(notExecutable, '..'));
    writeFileSync(notExecutable, '#!/bin/sh\nexit 3\n');
    expect(await locateSminos(m.deps({ env: { MAWS_SMINOS_CLI: notExecutable } }))).toMatchObject({ ok: false, reason: 'not-runnable' });
    expect(await locateSminos(m.deps({ env: { MAWS_SMINOS_CLI: join(m.root, 'missing', 'sminos') } }))).toMatchObject({ ok: false, reason: 'not-runnable' });
    expect(await locateSminos(m.deps({ env: { MAWS_SMINOS_CLI: 'relative/sminos' } }))).toMatchObject({ ok: false, reason: 'not-runnable' });
  });

  it('answers a probe that ignores SIGTERM as not runnable at its bound, so the locator is not held past it', async () => {
    const m = machine();
    const stubborn = join(m.root, 'f', 'sminos');
    mkdirSync(join(stubborn, '..'));
    writeFileSync(stubborn, "#!/bin/sh\ntrap '' TERM\necho \"$0\" >> \"$FAKE_SMINOS_RAN\"\nexec sleep 30\n");
    chmodSync(stubborn, 0o755);
    const asked = Date.now();
    expect(await locateSminos(m.deps({ env: { MAWS_SMINOS_CLI: stubborn }, probeMs: 1000 }))).toMatchObject({ ok: false, reason: 'not-runnable' });
    expect(Date.now() - asked).toBeLessThan(1400);
    expect(m.ran()).toEqual([stubborn]); // it did start, and ignored the TERM
  });

  it('proves a command once by its path and modification time, and again when the time moves or the proof is dropped', async () => {
    const m = machine();
    const path = stub(join(m.root, 'own', 'sminos'), 3);
    const proofs = new Set<string>();
    const deps = m.deps({ env: { MAWS_SMINOS_CLI: path }, proofs });
    await locateSminos(deps);
    await locateSminos(deps);
    expect(m.ran()).toHaveLength(1);
    utimesSync(path, new Date(), new Date(Date.now() + 5_000));
    await locateSminos(deps);
    expect(m.ran()).toHaveLength(2);
    proofs.clear(); // a spawn that failed drops the proof (the service does)
    await locateSminos(deps);
    expect(m.ran()).toHaveLength(3);
  });
});
