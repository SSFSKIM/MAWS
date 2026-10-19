// P3-F L256: the prelaunch guard that keeps an auth-advertising fixture out of every probe engine (P3-HD Decision Log 23;
// e2e/support/connector-direct-probe.ts) judges what the launch would actually read: the config homes its environment
// names, every project directory from its cwd up to the root, its environment values and its arguments. Engine-free:
// scratch files and the inputs a launch would be handed; no engine, fixture process or socket.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authFixtureExposure, type ProbeLaunchInputs } from '../../e2e/support/connector-direct-probe';

const PORT = 51_234;
const NAMED = `127.0.0.1:${PORT}`;
const URL_AT = (host = '127.0.0.1', port: number | string = PORT) => `http://${host}:${port}/mcp`;
const servers = (url = URL_AT()) => JSON.stringify({ mcpServers: { authy: { type: 'http', url } } });

let scratch: string;
let home: string;
let config: string;
let project: string;
beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-auth-guard-')));
  home = join(scratch, 'home');
  config = join(scratch, 'config');
  project = join(scratch, 'project');
  for (const dir of [home, config, join(project, 'sub')]) mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const inputs = (patch: Partial<ProbeLaunchInputs> = {}): ProbeLaunchInputs => ({ cwd: project, env: { HOME: home, CLAUDE_CONFIG_DIR: config, PATH: '/usr/bin:/bin' }, args: ['--settings', '{"env":{}}'], ...patch });
const write = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};
const exposed = (launch: ProbeLaunchInputs) => authFixtureExposure(launch, [PORT]);

describe('authFixtureExposure: what a probe launch would read', () => {
  it('a clean launch exposes nothing, and a server at another port is not the fixture', () => {
    expect(exposed(inputs())).toBeNull();
    write(join(config, '.claude.json'), servers(URL_AT('127.0.0.1', PORT + 1)));
    write(join(project, '.mcp.json'), servers(`http://127.0.0.1:1${PORT}/mcp`));
    expect(exposed(inputs())).toBeNull();
  });

  it('the effective cwd’s project files and every ancestor’s, not only the fixed layout’s project', () => {
    const sub = join(project, 'sub');
    write(join(sub, '.mcp.json'), servers());
    expect(exposed(inputs({ cwd: sub }))).toBe(NAMED);
    rmSync(join(sub, '.mcp.json'));
    write(join(scratch, '.mcp.json'), servers());
    expect(exposed(inputs({ cwd: sub }))).toBe(NAMED);
    rmSync(join(scratch, '.mcp.json'));
    write(join(sub, '.claude', 'settings.local.json'), JSON.stringify({ env: { XDG_URL: URL_AT() } }));
    expect(exposed(inputs({ cwd: sub }))).toBe(NAMED);
  });

  it('the config home the launch environment names, a HOME-only launch’s included', () => {
    const elsewhere = join(scratch, 'elsewhere');
    write(join(elsewhere, '.claude.json'), JSON.stringify({ projects: { [project]: { mcpServers: { authy: { type: 'http', url: URL_AT() } } } } }));
    expect(exposed(inputs())).toBeNull();
    expect(exposed(inputs({ env: { HOME: home, CLAUDE_CONFIG_DIR: elsewhere } }))).toBe(NAMED);
    write(join(home, '.claude.json'), servers());
    expect(exposed(inputs({ env: { HOME: home } }))).toBe(NAMED);
    rmSync(join(home, '.claude.json'));
    write(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { XDG_URL: URL_AT() } }));
    expect(exposed(inputs({ env: { HOME: home } }))).toBe(NAMED);
  });

  it('an environment value naming the fixture’s address', () => {
    expect(exposed(inputs({ env: { HOME: home, CLAUDE_CONFIG_DIR: config, XDG_URL: URL_AT() } }))).toBe(NAMED);
  });

  // Review fix: a reference can compose the port from pieces no single string holds, and settings can override the
  // environment it expands from, so its expansion is not an attested fact: any reference refuses while a fixture runs.
  it('an unresolved reference refuses the launch, a port split between the configuration and the environment included', () => {
    const split = { HOME: home, CLAUDE_CONFIG_DIR: config, XDG_SUFFIX: String(PORT).slice(2) };
    write(join(config, '.claude.json'), servers(`http://127.0.0.1:${String(PORT).slice(0, 2)}\${XDG_SUFFIX}/mcp`));
    expect(exposed(inputs({ env: split }))).toMatch(/unresolved reference/);
    expect(exposed(inputs())).toMatch(/unresolved reference/); // whatever the environment holds
    rmSync(join(config, '.claude.json'));
    expect(exposed(inputs({ args: ['--mcp-config', servers('${XDG_URL}')] }))).toMatch(/unresolved reference/);
    write(join(project, '.mcp.json'), servers('${XDG_URL}'));
    expect(authFixtureExposure(inputs(), [])).toBeNull(); // no auth fixture running: nothing to refuse
  });

  // Review fix: the OS resolves a link before `..`, path.resolve erases `..` first; the engine may read either.
  it('the physical cwd and its ancestors: a cwd through a link, or a link followed by `..`', () => {
    mkdirSync(join(scratch, 'real', 'sub'), { recursive: true });
    symlinkSync(join(scratch, 'real', 'sub'), join(scratch, 'link'));
    write(join(scratch, 'real', '.mcp.json'), servers());
    expect(exposed(inputs({ cwd: join(scratch, 'link') + '/..' }))).toBe(NAMED); // the spawn runs in real, not scratch
    expect(exposed(inputs({ cwd: join(scratch, 'link') }))).toBe(NAMED); // real is the physical parent of real/sub
    rmSync(join(scratch, 'real', '.mcp.json'));
    write(join(scratch, '.mcp.json'), servers());
    expect(exposed(inputs({ cwd: join(scratch, 'link') + '/..' }))).toBe(NAMED); // the lexical reading is kept too
    expect(() => exposed(inputs({ cwd: join(scratch, 'absent') }))).toThrow(); // a cwd it cannot resolve refuses
  });

  it('path-valued inputs by the same rule: a config home through a link and `..`, a relative one, a configuration file argument', () => {
    mkdirSync(join(scratch, 'real', 'sub'), { recursive: true });
    symlinkSync(join(scratch, 'real', 'sub'), join(scratch, 'link'));
    write(join(scratch, 'real', '.claude.json'), servers());
    expect(exposed(inputs({ env: { HOME: home, CLAUDE_CONFIG_DIR: join(scratch, 'link') + '/..' } }))).toBe(NAMED);
    rmSync(join(scratch, 'real', '.claude.json'));
    write(join(project, 'relative-home', '.claude.json'), servers());
    expect(exposed(inputs({ env: { HOME: home, CLAUDE_CONFIG_DIR: 'relative-home' } }))).toBe(NAMED); // from the cwd
    write(join(project, 'dynamic.json'), servers());
    expect(exposed(inputs({ args: ['--mcp-config', 'dynamic.json', '--settings', '{}'] }))).toBe(NAMED);
    expect(() => exposed(inputs({ args: ['--settings', join(scratch, 'absent.json')] }))).toThrow();
  });

  it('the dynamic configuration and the flag settings among the arguments', () => {
    expect(exposed(inputs({ args: ['--mcp-config', servers(), '--settings', '{}'] }))).toBe(NAMED);
    expect(exposed(inputs({ args: ['--settings', JSON.stringify({ env: { XDG_URL: URL_AT() } })] }))).toBe(NAMED);
  });

  it('any spelling of the fixture’s address: another host form, a zero-padded port, escaped slashes', () => {
    for (const url of [URL_AT('localhost'), URL_AT('[::1]'), URL_AT('2130706433'), URL_AT('127.1'), URL_AT('127.0.0.1', `00${PORT}`)]) {
      write(join(project, '.mcp.json'), servers(url));
      expect(exposed(inputs()), url).toBe(NAMED);
    }
    write(join(project, '.mcp.json'), `{"mcpServers":{"authy":{"type":"http","url":"http:\\/\\/127.0.0.1:${PORT}\\/mcp"}}}`);
    expect(exposed(inputs())).toBe(NAMED);
    write(join(project, '.mcp.json'), `{ "mcpServers": { "authy": { "url": "${URL_AT()}" } }, } // not strict JSON`);
    expect(exposed(inputs())).toBe(NAMED);
  });

  it.skipIf(process.getuid?.() === 0)('a configuration file it cannot read refuses the launch rather than passing it', () => {
    write(join(config, '.claude.json'), servers(URL_AT('127.0.0.1', PORT + 1)));
    chmodSync(join(config, '.claude.json'), 0o000);
    try {
      expect(() => exposed(inputs())).toThrow();
    } finally {
      chmodSync(join(config, '.claude.json'), 0o600);
    }
  });
});
