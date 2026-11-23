// The custom connector's form rules (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, "The form's
// fields", §A, §E): every refusal in §E's words, each field's first problem whatever the others hold, the entry Add sends
// and nothing of the other type, and the opening's read that the name is checked against.
import { describe, expect, it } from 'vitest';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import { MCP_ENTRY_BOUNDS } from '@shared/plugins/cli';
import { addToScopes, addToWords, checkCustom, configuredSinceOpening, customFieldsOf, customInputOf, type CustomFields } from './custom-form';

const fields = (over: Partial<CustomFields> = {}): CustomFields => ({ name: 'files-probe', type: 'http', url: 'https://files.example.test/mcp', headers: [], command: '', args: '', env: [], scope: 'user', ...over });
const local = (over: Partial<CustomFields> = {}) => fields({ type: 'stdio', url: '', command: '/opt/probe/bin/files-probe', ...over });
const server = (name: string, scope: CustomizationServer['scope'] = 'user', path = '/cfg/.claude.json'): CustomizationServer => ({ name, scope, path, transport: 'http' });

describe('the entry Add sends', () => {
  it('a remote one: the type, the URL as typed and the headers; no variable, command or argument of the other type', () => {
    const check = checkCustom(fields({ headers: [{ name: 'X-Probe-Key', value: 'value-one' }], command: '/opt/x', args: '--root a', env: [{ name: 'MODE', value: 'value-two' }] }), []);
    expect(check.entry).toEqual({ type: 'http', url: 'https://files.example.test/mcp', headers: [{ name: 'X-Probe-Key', value: 'value-one' }] });
    expect(checkCustom(fields({ type: 'sse' }), []).entry).toEqual({ type: 'sse', url: 'https://files.example.test/mcp', headers: [] });
  });

  it('a local one: the command with its end spaces dropped, the arguments split, the variables; nothing remote', () => {
    const check = checkCustom(local({ command: '  /opt/probe/bin/files probe  ', args: '--root "/tmp/my files" -v', env: [{ name: 'MODE', value: 'value-one' }], headers: [{ name: 'X-Probe-Key', value: 'value-two' }] }), []);
    expect(check.entry).toEqual({ type: 'stdio', command: '/opt/probe/bin/files probe', args: ['--root', '/tmp/my files', '-v'], env: [{ name: 'MODE', value: 'value-one' }] });
    expect(check.commandHasSpace).toBe(true); // a note, refusing nothing
    expect(checkCustom(local(), []).entry).toEqual({ type: 'stdio', command: '/opt/probe/bin/files-probe', args: [], env: [] });
  });

  it('a row with neither a name nor a value is not sent; a name with an empty value is sent', () => {
    const check = checkCustom(fields({ headers: [{ name: '', value: '' }, { name: 'X-Empty', value: '' }] }), []);
    expect(check.entry).toEqual({ type: 'http', url: 'https://files.example.test/mcp', headers: [{ name: 'X-Empty', value: '' }] });
  });

  it('a pair is sent as exactly its name and value, whatever else the sheet keeps on a row', () => {
    const row = { name: 'MODE', value: 'value-one', id: 7 };
    expect(checkCustom(local({ env: [row] }), []).entry).toEqual({ type: 'stdio', command: '/opt/probe/bin/files-probe', args: [], env: [{ name: 'MODE', value: 'value-one' }] });
  });

  it('confirms { name, scope, entry } only once what is configured here is read whole and the name is free', () => {
    const typed = fields({ scope: 'project' });
    const check = checkCustom(typed, []);
    expect(customInputOf(typed, check, { state: 'read', servers: [] })).toEqual({ name: 'files-probe', scope: 'project', entry: { type: 'http', url: 'https://files.example.test/mcp', headers: [] } });
    for (const configured of [{ state: 'reading' }, { state: 'partial' }, { state: 'failed', message: 'unread' }] as const) expect(customInputOf(typed, check, configured)).toBeNull();
    const taken = checkCustom(typed, [server('files-probe', 'local')]);
    expect(customInputOf(typed, taken, { state: 'read', servers: [server('files-probe', 'local')] })).toBeNull();
  });
});

describe('the name', () => {
  it('today’s two refusals, the reserved names, and a name configured here with that entry, MAWS’s own list included', () => {
    expect(checkCustom(fields({ name: '' }), []).name).toBe('Enter a name.');
    expect(checkCustom(fields({ name: 'files probe' }), []).name).toBe('Use letters, digits, hyphens and underscores only.');
    for (const name of ['maws', 'workspace', 'claude-in-chrome']) expect(checkCustom(fields({ name }), []).name).toBe('This name is reserved by Claude Code or by MAWS.');
    expect(checkCustom(fields(), [server('files-probe', 'project', '/p/.mcp.json')]).existing).toEqual(server('files-probe', 'project', '/p/.mcp.json'));
    expect(checkCustom(fields(), [server('files-probe', 'app', '/maws/settings.json')]).existing?.scope).toBe('app');
    expect(checkCustom(fields(), null).existing).toBeNull(); // not read yet: nothing to show, and Add waits
  });
});

describe('the URL', () => {
  it('http or https with a host and no surrounding space, as typed; empty, a control character and the bound', () => {
    expect(checkCustom(fields({ url: '' }), []).url).toBe('Enter the server’s URL.');
    for (const url of ['ftp://files.example.test', 'https://', 'not a url', ' https://files.example.test/mcp']) expect(checkCustom(fields({ url }), []).url, url).toBe('Enter an http or https URL.');
    expect(checkCustom(fields({ url: 'https://files.example.test/\nmcp' }), []).url).toBe('This field can’t hold a line break or a control character.');
    expect(checkCustom(fields({ url: `https://files.example.test/${'a'.repeat(MCP_ENTRY_BOUNDS.url)}` }), []).url).toBe('The URL is too long. The limit is 4,096 characters.');
    expect(checkCustom(fields({ url: 'http://localhost:7000/mcp' }), []).url).toBeNull();
  });

  it('a row’s problem is found while the URL is still empty', () => {
    const check = checkCustom(fields({ url: '', headers: [{ name: 'X Probe', value: 'value-one' }] }), []);
    expect(check.url).toBe('Enter the server’s URL.');
    expect(check.rows[0].problem).toBe('Use letters, digits and hyphens in a header name, without spaces.');
    expect(check.entry).toBeNull();
  });
});

describe('the rows', () => {
  it('a value with no name, a name off the rule, two of one name (headers case ignored), a control character, a value over its bound, too many rows', () => {
    expect(checkCustom(fields({ headers: [{ name: '', value: 'value-one' }] }), []).rows[0].problem).toBe('Enter a name for this header.');
    expect(checkCustom(local({ env: [{ name: '', value: 'value-one' }] }), []).rows[0].problem).toBe('Enter a name for this variable.');
    expect(checkCustom(local({ env: [{ name: '1MODE', value: 'value-one' }] }), []).rows[0].problem).toBe('Use letters, digits and underscores in a variable name, not starting with a digit.');
    const twice = checkCustom(fields({ headers: [{ name: 'X-Probe', value: 'value-one' }, { name: 'x-probe', value: 'value-two' }] }), []);
    expect(twice.rows.map((row) => row.problem)).toEqual([null, 'Two headers are named x-probe.']);
    expect(checkCustom(local({ env: [{ name: 'MODE', value: 'value-one' }, { name: 'MODE', value: 'value-two' }] }), []).rows[1].problem).toBe('Two variables are named MODE.');
    expect(checkCustom(local({ env: [{ name: 'MODE', value: 'value\none' }] }), []).rows[0].problem).toBe('This field can’t hold a line break or a control character.');
    expect(checkCustom(local({ env: [{ name: 'MODE', value: 'v'.repeat(MCP_ENTRY_BOUNDS.value + 1) }] }), []).rows[0].problem).toBe('This value is too long. The limit is 8,192 characters.');
    const many = checkCustom(fields({ headers: Array.from({ length: MCP_ENTRY_BOUNDS.headers + 1 }, (_, i) => ({ name: `X-Probe-${i}`, value: 'value-one' })) }), []);
    expect(many.rowsProblem).toBe('Too many headers. The limit is 64.');
    expect(many.entry).toBeNull();
  });

  it('each row’s first problem, beside an empty row the indices skip nothing', () => {
    const check = checkCustom(fields({ headers: [{ name: '', value: '' }, { name: 'X Probe', value: 'value-one' }, { name: 'X-Probe', value: 'value-two' }] }), []);
    expect(check.rows.map((row) => row.problem)).toEqual([null, 'Use letters, digits and hyphens in a header name, without spaces.', null]);
  });

  it('the shared file’s warning: the project scope with a row holding a name or a value of the chosen type', () => {
    expect(checkCustom(fields({ scope: 'project', headers: [{ name: 'X-Probe', value: '' }] }), []).sharedWarning).toBe(true);
    expect(checkCustom(fields({ scope: 'project', headers: [{ name: '', value: 'value-one' }] }), []).sharedWarning).toBe(true);
    expect(checkCustom(fields({ scope: 'project', headers: [{ name: '', value: '' }] }), []).sharedWarning).toBe(false);
    expect(checkCustom(fields({ scope: 'local', headers: [{ name: 'X-Probe', value: 'value-one' }] }), []).sharedWarning).toBe(false);
    expect(checkCustom(fields({ scope: 'project', env: [{ name: 'MODE', value: 'value-one' }] }), []).sharedWarning).toBe(false); // the other type's rows
    expect(checkCustom(local({ scope: 'project', env: [{ name: 'MODE', value: 'value-one' }] }), []).sharedWarning).toBe(true);
  });

  it('the whole configuration over its bound', () => {
    const value = 'v'.repeat(MCP_ENTRY_BOUNDS.value);
    const check = checkCustom(fields({ headers: Array.from({ length: 5 }, (_, i) => ({ name: `X-Probe-${i}`, value })) }), []);
    expect(check.rows.every((row) => row.problem === null)).toBe(true);
    expect(check.entryProblem).toBe('This configuration is too large to add. The limit is 32,768 bytes.');
    expect(check.entry).toBeNull();
  });
});

describe('the command and the arguments', () => {
  it('an empty command, a control character, the bound; spaces at the ends dropped, inside a note', () => {
    expect(checkCustom(local({ command: '   ' }), []).command).toBe('Enter the command.');
    expect(checkCustom(local({ command: '/opt/x\tprobe' }), []).command).toBe('This field can’t hold a line break or a control character.');
    expect(checkCustom(local({ command: `/${'a'.repeat(MCP_ENTRY_BOUNDS.command)}` }), []).command).toBe('The command is too long. The limit is 4,096 characters.');
    expect(checkCustom(local({ command: ' /opt/x ' }), []).commandHasSpace).toBe(false);
  });

  it('split as a shell splits words (G4); an empty argument kept; a line ending in a quote or a backslash refused', () => {
    expect(checkCustom(local({ args: '--root "/tmp/my files" -v' }), []).args).toEqual({ ok: true, words: ['--root', '/tmp/my files', '-v'] });
    expect(checkCustom(local({ args: "--name '' -v" }), []).args).toEqual({ ok: true, words: ['--name', '', '-v'] });
    expect(checkCustom(local({ args: '--root "/tmp/my' }), []).args).toEqual({ ok: false, problem: 'The arguments end inside a quote.' });
    expect(checkCustom(local({ args: "--root '/tmp" }), []).args).toEqual({ ok: false, problem: 'The arguments end inside a quote.' });
    expect(checkCustom(local({ args: '--root \\' }), []).args).toEqual({ ok: false, problem: 'The arguments end with a backslash.' });
    expect(checkCustom(local({ args: '--root "/tmp/my' }), []).entry).toBeNull();
    expect(checkCustom(local({ args: Array.from({ length: MCP_ENTRY_BOUNDS.args + 1 }, () => 'a').join(' ') }), []).argsProblem).toBe('Too many arguments. The limit is 256.');
  });
});

describe('a name the engine empties (G7)', () => {
  it('under the URL and a header’s row, for each of the five names the record proves; none for a name of one’s own; none on a local command', () => {
    for (const name of ['NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'OTEL_EXPORTER_OTLP_HEADERS']) {
      const check = checkCustom(fields({ url: `https://files.example.test/mcp?k=\${${name}}`, headers: [{ name: 'X-Probe', value: `\${${name}:-none}` }] }), []);
      expect(check.urlEmptied, name).toEqual([name]);
      expect(check.rows[0].emptied, name).toEqual([name]);
      expect(check.entry, name).not.toBeNull(); // Add stays enabled
    }
    expect(checkCustom(fields({ headers: [{ name: 'X-Probe', value: '${MYSERVICE_TOKEN}' }] }), []).rows[0].emptied).toEqual([]);
    expect(checkCustom(local({ env: [{ name: 'NPM_TOKEN', value: '${NPM_TOKEN}' }] }), []).rows[0].emptied).toEqual([]);
  });
});

describe('the sheet’s starting values and scopes', () => {
  it('opens from the request it is given, the other type empty; a local entry’s arguments as a line that splits back', () => {
    expect(customFieldsOf({ name: '', scope: 'user', entry: { type: 'http', url: '', headers: [] } })).toEqual(fields({ name: '', url: '' }));
    const opened = customFieldsOf({ name: 'files-probe', scope: 'local', entry: { type: 'stdio', command: '/opt/x', args: ['--root', '/tmp/my files', '', "it's"], env: [{ name: 'MODE', value: 'value-one' }] } });
    expect(checkCustom(opened, []).args).toEqual({ ok: true, words: ['--root', '/tmp/my files', '', "it's"] });
  });

  it('"Add to": all projects alone on the user configuration’s page, the project’s two on its page, in §E’s words', () => {
    expect(addToScopes(null)).toEqual(['user']);
    expect(addToScopes('/p')).toEqual(['user', 'local', 'project']);
    expect(['user', 'local', 'project'].map((scope) => addToWords(scope as 'user', 'files-lab'))).toEqual(['All projects', 'files-lab only', 'files-lab, shared in its .mcp.json']);
  });

  it('what is configured here counts only once the opening’s read answered and no read is out', () => {
    const read = { state: 'read', servers: [] } as const;
    expect(configuredSinceOpening(false, { isFetching: false, configured: read })).toEqual({ state: 'reading' });
    expect(configuredSinceOpening(true, { isFetching: true, configured: read })).toEqual({ state: 'reading' });
    expect(configuredSinceOpening(true, { isFetching: false, configured: read })).toBe(read);
    expect(configuredSinceOpening(true, { isFetching: false, configured: { state: 'failed', message: 'unread' } })).toEqual({ state: 'failed', message: 'unread' });
  });
});

// R11: a sentence over a bound names what is over, then the limit, read from MCP_ENTRY_BOUNDS (the constant the check
// uses) with a comma between thousands.
describe('over a bound (R11)', () => {
  const B = MCP_ENTRY_BOUNDS;
  const written = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const pairs = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `ROW_${i}`, value: 'value-one' }));
  const headerPairs = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `X-Row-${i}`, value: 'value-one' }));
  const cases: [string, string, string][] = [
    ['arguments', checkCustom(local({ args: Array.from({ length: B.args + 1 }, () => 'a').join(' ') }), []).argsProblem!, `Too many arguments. The limit is ${written(B.args)}.`],
    ['headers', checkCustom(fields({ headers: headerPairs(B.headers + 1) }), []).rowsProblem!, `Too many headers. The limit is ${written(B.headers)}.`],
    ['variables', checkCustom(local({ env: pairs(B.env + 1) }), []).rowsProblem!, `Too many variables. The limit is ${written(B.env)}.`],
    ['the URL', checkCustom(fields({ url: `https://files.example.test/${'a'.repeat(B.url)}` }), []).url!, `The URL is too long. The limit is ${written(B.url)} characters.`],
    ['the command', checkCustom(local({ command: `/${'a'.repeat(B.command)}` }), []).command!, `The command is too long. The limit is ${written(B.command)} characters.`],
    ['an argument', checkCustom(local({ args: `a b ${'c'.repeat(B.arg + 1)}` }), []).argsProblem!, `Argument 3 is too long. The limit is ${written(B.arg)} characters.`],
    ['a value', checkCustom(fields({ headers: [{ name: 'X-Probe', value: 'v'.repeat(B.value + 1) }] }), []).rows[0].problem!, `This value is too long. The limit is ${written(B.value)} characters.`],
    ['the whole', checkCustom(fields({ headers: Array.from({ length: 5 }, (_, i) => ({ name: `X-Probe-${i}`, value: 'v'.repeat(B.value) })) }), []).entryProblem!, `This configuration is too large to add. The limit is ${written(B.json)} bytes.`],
  ];

  it('each of §E’s eight sentences, its number the constant’s', () => {
    for (const [what, said, expected] of cases) expect(said, what).toBe(expected);
  });

  it('as §E writes them', () => {
    expect(cases.map(([, said]) => said)).toEqual([
      'Too many arguments. The limit is 256.',
      'Too many headers. The limit is 64.',
      'Too many variables. The limit is 128.',
      'The URL is too long. The limit is 4,096 characters.',
      'The command is too long. The limit is 4,096 characters.',
      'Argument 3 is too long. The limit is 8,192 characters.',
      'This value is too long. The limit is 8,192 characters.',
      'This configuration is too large to add. The limit is 32,768 bytes.',
    ]);
  });

  it('a row’s name over its length is §A’s name rule, and reads as it', () => {
    expect(checkCustom(fields({ headers: [{ name: `X-${'a'.repeat(B.pairName)}`, value: 'value-one' }] }), []).rows[0].problem).toBe('Use letters, digits and hyphens in a header name, without spaces.');
    expect(checkCustom(local({ env: [{ name: `A${'a'.repeat(B.pairName)}`, value: 'value-one' }] }), []).rows[0].problem).toBe('Use letters, digits and underscores in a variable name, not starting with a digit.');
  });
});
