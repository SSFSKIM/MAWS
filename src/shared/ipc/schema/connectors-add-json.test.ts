// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §B): `connectors.addJson`, a custom
// connector's entry for `claude mcp add-json`. The three types are taken; a key the shape does not hold, each bound's
// first value over, a reserved name and a folder that does not pair with the scope and cwd are refused; no issue
// raised on a value slot carries what it received (R2).
import { describe, expect, it } from 'vitest';
import { MCP_ENTRY_BOUNDS as B } from '../../plugins/cli';
import { gradeOf } from '../grades';
import { NAMES } from '../names';
import { PATH_COMMANDS } from '../routes';
import { commands } from '../schema';
import { validateCommandInput } from '../validate';

const FOLDER = '/tmp/files-probe';
const http = { type: 'http', url: 'https://files.example.test/mcp', headers: [{ name: 'X-Files-Key', value: 'value-one' }] };
const stdio = { type: 'stdio', command: 'files-probe', args: ['--root', '/tmp/my files'], env: [{ name: 'FILES_PROBE_KEY', value: 'value-two' }] };
const input = (entry: unknown, over: Record<string, unknown> = {}) => ({ cwd: FOLDER, binary: '/opt/claude/bin/claude', name: 'files-probe', scope: 'local', entry, folder: FOLDER, ...over });
const accepted = (value: unknown) => validateCommandInput('connectors.addJson', value).ok;

describe('connectors.addJson', () => {
  it('is the engine host’s, bridged to the window beside connectors.add, graded machine-admin, a path command', () => {
    expect(commands['connectors.addJson'].owner).toBe('engine-host');
    expect([...NAMES.connectors.commands]).toContain('connectors.addJson');
    expect(gradeOf('connectors.addJson')).toBe('machine-admin');
    expect([...PATH_COMMANDS]).toContain('connectors.addJson');
  });

  it('takes the three types at each scope, with and without headers, variables and arguments', () => {
    for (const entry of [http, { ...http, type: 'sse' }, { ...http, headers: [] }, stdio, { ...stdio, args: [], env: [] }]) {
      expect(accepted(input(entry)), JSON.stringify(entry)).toBe(true);
      expect(accepted(input(entry, { scope: 'project' }))).toBe(true);
      expect(accepted(input(entry, { scope: 'user', folder: null, cwd: '/home/files/.claude' }))).toBe(true); // the user configuration's page
      expect(accepted(input(entry, { scope: 'user' }))).toBe(true); // all projects, from a project's page
    }
  });

  it('refuses ws, an unknown key, a header on a local command and a variable on a remote one', () => {
    expect(accepted(input({ ...http, type: 'ws' }))).toBe(false);
    expect(accepted(input({ ...http, oauth: {} }))).toBe(false);
    expect(accepted(input(http, { extra: true }))).toBe(false);
    expect(accepted(input({ ...stdio, headers: [] }))).toBe(false);
    expect(accepted(input({ ...http, env: [] }))).toBe(false);
    expect(accepted(input({ ...http, headers: [{ name: 'X-A', value: 'v', extra: 1 }] }))).toBe(false);
    expect(accepted(input({ type: 'stdio', command: 'files-probe', args: [] }))).toBe(false); // env is always sent
  });

  it('refuses each bound’s first value over', () => {
    const pairs = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, value: 'v' }));
    const over = [
      { ...http, url: `https://files.example.test/${'x'.repeat(B.url)}` },
      { ...http, headers: pairs(B.headers + 1, 'X-H') },
      { ...http, headers: [{ name: 'x'.repeat(B.pairName + 1), value: 'v' }] },
      { ...http, headers: [{ name: 'X-A', value: 'x'.repeat(B.value + 1) }] },
      { ...stdio, command: 'x'.repeat(B.command + 1) },
      { ...stdio, args: Array.from({ length: B.args + 1 }, () => 'a') },
      { ...stdio, args: ['x'.repeat(B.arg + 1)] },
      { ...stdio, env: pairs(B.env + 1, 'K') },
      { ...stdio, args: Array.from({ length: 5 }, () => 'x'.repeat(B.arg)) }, // the JSON text over 32,768 bytes
    ];
    for (const entry of over) expect(accepted(input(entry)), JSON.stringify(entry).slice(0, 80)).toBe(false);
    // and each at its bound is taken
    expect(accepted(input({ ...http, headers: [{ name: 'X-A', value: 'x'.repeat(B.value) }] }))).toBe(true);
    expect(accepted(input({ ...stdio, env: pairs(B.env, 'K') }))).toBe(true);
  });

  it('refuses what the entry’s one rule refuses: a duplicate name, a URL that is not http or https, a control character', () => {
    expect(accepted(input({ ...http, headers: [{ name: 'X-A', value: 'a' }, { name: 'x-a', value: 'b' }] }))).toBe(false);
    expect(accepted(input({ ...stdio, env: [{ name: 'K', value: 'a' }, { name: 'K', value: 'b' }] }))).toBe(false);
    expect(accepted(input({ ...http, url: 'not a url' }))).toBe(false);
    expect(accepted(input({ ...stdio, command: '' }))).toBe(false);
    expect(accepted(input({ ...stdio, env: [{ name: 'K', value: 'value\none' }] }))).toBe(false);
  });

  it('refuses maws, a name the engine reserves, and a name the engine refuses', () => {
    for (const name of ['maws', 'claude_ai', 'workspace', '__proto__', 'two words', 'dot.name', '-y', 'x'.repeat(129)]) expect(accepted(input(stdio, { name })), name).toBe(false);
  });

  it('refuses a folder that does not pair with the scope and the cwd', () => {
    expect(accepted(input(stdio, { folder: null }))).toBe(false); // the user configuration's page adds at user scope alone
    expect(accepted(input(stdio, { folder: null, scope: 'project' }))).toBe(false);
    expect(accepted(input(stdio, { folder: '/tmp/other' }))).toBe(false); // with a folder, the CLI runs in it
    expect(accepted(input(stdio, { folder: 'relative/path', cwd: 'relative/path' }))).toBe(false);
    expect(accepted(input(stdio, { folder: undefined }))).toBe(false); // always sent
  });

  it('raises no issue that carries a value slot’s content (R2)', () => {
    const long = `value-one-${'x'.repeat(B.value)}`;
    const control = 'value-one\u0007more';
    for (const value of [long, control]) {
      for (const entry of [{ ...http, headers: [{ name: 'X-A', value }] }, { ...stdio, env: [{ name: 'K', value }] }]) {
        const checked = validateCommandInput('connectors.addJson', input(entry));
        expect(checked.ok).toBe(false);
        const said = JSON.stringify(checked);
        expect(said.includes(value) || said.includes(JSON.stringify(value).slice(1, -1))).toBe(false);
      }
    }
  });
});
