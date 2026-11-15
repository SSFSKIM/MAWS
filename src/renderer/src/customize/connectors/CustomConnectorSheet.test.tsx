// The custom connector's sheet (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, "The form's fields",
// "Secrets", "A name the engine empties", §D, §E; the architect's two rulings for M2): drawn by ConnectorSheet for a
// request whose input holds an entry; each type's fields; Add confirms { name, scope, entry } with the page's folder; the
// refusals, the split arguments, the sentences by their rules; and with Details open nothing outside the value fields
// holds a value, the command reading `•••` in its place, each piece of it one unbreakable unit.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestFor, type PluginsRequest } from '../../widgets/plugins/present';
import { ConnectorSheet, type ConnectorSheetEnv } from './ConnectorSheet';

afterEach(cleanup);

const OPENED = requestFor('mcp-add', { name: '', scope: 'user', entry: { type: 'http', url: '', headers: [] } }, null);
const env = (over: Partial<ConnectorSheetEnv> = {}): ConnectorSheetEnv => ({ cwd: '/work/files-lab', runCwd: '/work/files-lab', place: 'files-lab', engine: { state: 'ready', env: { binary: '/engine/claude', configHome: '/cfg', globalConfig: '/cfg/.claude.json' } }, configured: { state: 'read', servers: [] }, retryServers: () => {}, ...over });
const open = (e = env(), request: PluginsRequest = OPENED) => {
  const onConfirm = vi.fn();
  render(<ConnectorSheet request={request} env={e} onConfirm={onConfirm} onClose={() => {}} />);
  return { sheet: screen.getByRole('dialog', { name: 'Add custom connector' }), onConfirm };
};
const add = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
const field = (sheet: HTMLElement, selector: string) => sheet.querySelector(selector) as HTMLInputElement;
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });
const name = (sheet: HTMLElement, value: string) => type(field(sheet, '[data-connector-name]'), value);
const choose = (sheet: HTMLElement, label: string) => fireEvent.click(within(sheet).getByRole('radio', { name: label }));
const problems = (sheet: HTMLElement) => [...sheet.querySelectorAll('[data-connector-problem]')].map((p) => p.textContent);
const rowsOf = (sheet: HTMLElement) => [...sheet.querySelectorAll<HTMLElement>('[data-connector-row]')];
function addRow(sheet: HTMLElement, button: 'Add header' | 'Add variable', rowName: string, value: string) {
  fireEvent.click(within(sheet).getByRole('button', { name: button }));
  const row = rowsOf(sheet).at(-1)!;
  type(row.querySelector('[data-connector-row-name]')!, rowName);
  type(row.querySelector('[data-connector-value]')!, value);
  return row;
}
const openDetails = (sheet: HTMLElement) => {
  const button = within(sheet).getByRole('button', { name: 'Details' });
  if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
};

describe('the custom connector sheet', () => {
  it('opens with Remote (HTTP), all projects first and Details closed; the type’s fields, no header row; the sentences of today', () => {
    const { sheet } = open();
    expect((within(sheet).getByRole('radio', { name: 'Remote (HTTP)' }) as HTMLInputElement).checked).toBe(true);
    expect(within(sheet).getByRole('radio', { name: 'Remote (SSE)' })).toBeTruthy();
    expect(within(sheet).getByRole('radio', { name: 'Local command' })).toBeTruthy();
    expect((within(sheet).getByRole('radio', { name: 'All projects' }) as HTMLInputElement).checked).toBe(true);
    expect(within(sheet).getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('false');
    expect(sheet.querySelector('[data-plugins-argv]')).toBeNull();
    expect(within(sheet).getByRole('textbox', { name: 'URL' })).toBeTruthy();
    expect(within(sheet).getByRole('group', { name: 'Request headers' })).toBeTruthy();
    expect(rowsOf(sheet)).toEqual([]);
    expect(sheet.querySelector('[data-connector-command-field]')).toBeNull();
    expect(sheet.textContent).toContain('Sessions started from now on load it; running sessions do not.');
    expect(problems(sheet)).toEqual([]); // nothing is said of a field nobody has typed in
    expect(add(sheet).disabled).toBe(true);
  });

  it('a remote connector: Add confirms { name, scope, entry } with the page’s folder, the header sent, nothing of the local type', () => {
    const { sheet, onConfirm } = open();
    name(sheet, 'files-probe');
    choose(sheet, 'Local command');
    type(field(sheet, '[data-connector-command-field]'), '/opt/probe/bin/files-probe');
    addRow(sheet, 'Add variable', 'MODE', 'value-two');
    choose(sheet, 'Remote (SSE)');
    type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/sse');
    addRow(sheet, 'Add header', 'X-Probe-Key', 'value-one');
    choose(sheet, 'files-lab, shared in its .mcp.json');
    fireEvent.click(add(sheet));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [confirmed, binary] = onConfirm.mock.calls[0] as [PluginsRequest, string];
    expect(binary).toBe('/engine/claude');
    expect(confirmed.action).toBe('mcp-add');
    expect(confirmed.input).toEqual({ name: 'files-probe', scope: 'project', entry: { type: 'sse', url: 'https://files.example.test/sse', headers: [{ name: 'X-Probe-Key', value: 'value-one' }] } });
    expect(confirmed.folder).toBe('/work/files-lab');
  });

  it('a local command: the command, the arguments as split and the variables; what was typed for the other type kept, not sent', () => {
    const { sheet, onConfirm } = open();
    name(sheet, 'files-probe');
    type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
    choose(sheet, 'Local command');
    expect(within(sheet).queryByRole('textbox', { name: 'URL' })).toBeNull();
    expect(within(sheet).getByRole('group', { name: 'Environment' })).toBeTruthy();
    type(field(sheet, '[data-connector-command-field]'), ' /opt/probe/bin/files-probe ');
    type(field(sheet, '[data-connector-args-field]'), '--root "/tmp/my files" -v');
    addRow(sheet, 'Add variable', 'MODE', 'value-one');
    choose(sheet, 'files-lab only');
    choose(sheet, 'Remote (HTTP)');
    expect(field(sheet, '[data-connector-url-field]').value).toBe('https://files.example.test/mcp');
    choose(sheet, 'Local command');
    expect(field(sheet, '[data-connector-command-field]').value).toBe(' /opt/probe/bin/files-probe ');
    fireEvent.click(add(sheet));
    expect((onConfirm.mock.calls[0][0] as PluginsRequest).input).toEqual({ name: 'files-probe', scope: 'local', entry: { type: 'stdio', command: '/opt/probe/bin/files-probe', args: ['--root', '/tmp/my files', '-v'], env: [{ name: 'MODE', value: 'value-one' }] } });
  });

  it('a row with neither a name nor a value is not sent, and while there is one the sheet says so', () => {
    const { sheet, onConfirm } = open();
    name(sheet, 'files-probe');
    type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add header' }));
    expect(sheet.textContent).toContain('An empty row is not added.');
    expect(sheet.textContent).toContain('Saved in Claude Code’s configuration file as written.'); // a row, filled or not
    fireEvent.click(add(sheet));
    expect((onConfirm.mock.calls[0][0] as PluginsRequest).input).toEqual({ name: 'files-probe', scope: 'user', entry: { type: 'http', url: 'https://files.example.test/mcp', headers: [] } });
    type(rowsOf(sheet)[0].querySelector('[data-connector-row-name]')!, 'X-Probe');
    expect(sheet.textContent).not.toContain('An empty row is not added.');
    fireEvent.click(within(rowsOf(sheet)[0]).getByRole('button', { name: 'Remove X-Probe' }));
    expect(rowsOf(sheet)).toEqual([]);
    expect(sheet.textContent).not.toContain('Saved in Claude Code’s configuration file as written.');
  });

  it('a row’s Remove is named by its name, or its number', () => {
    const { sheet } = open();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add header' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add header' }));
    expect(within(rowsOf(sheet)[1]).getByRole('button', { name: 'Remove 2' })).toBeTruthy();
    expect(within(rowsOf(sheet)[0]).getAllByRole('textbox').map((box) => box.getAttribute('aria-label'))).toEqual(['Name', 'Value']);
  });

  it('"Add to" on a project’s page offers the three; on the user configuration’s page its one choice as words, no radio, no "Scope: User"', () => {
    const project = open();
    expect(within(within(project.sheet).getByRole('group', { name: 'Add to' })).getAllByRole('radio').map((radio) => radio.parentElement!.textContent)).toEqual(['All projects', 'files-lab only', 'files-lab, shared in its .mcp.json']);
    cleanup();
    const { sheet, onConfirm } = open(env({ cwd: null, runCwd: '/cfg', place: null }));
    expect(within(sheet).queryByRole('group', { name: 'Add to' })).toBeNull();
    expect(within(sheet).queryByRole('radio', { name: 'All projects' })).toBeNull();
    const words = sheet.querySelector('[data-connector-add-to]')!;
    expect(words.textContent).toBe('All projects');
    expect(words.previousElementSibling!.textContent).toBe('Add to');
    expect(sheet.querySelector('[data-plugins-scope]')).toBeNull();
    expect(sheet.textContent).not.toContain('Scope: User');
    name(sheet, 'files-probe');
    type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
    fireEvent.click(add(sheet));
    const confirmed = onConfirm.mock.calls[0][0] as PluginsRequest;
    expect((confirmed.input as { scope: string }).scope).toBe('user');
    expect(confirmed.folder).toBeNull();
  });

  it('R11: Add stays unavailable while a required field is empty, untouched or emptied; its sentence shows only once it was typed in', () => {
    const name_ = open();
    type(field(name_.sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
    expect(add(name_.sheet).disabled).toBe(true); // the name untouched and empty
    expect(problems(name_.sheet)).toEqual([]);
    name(name_.sheet, 'files-probe');
    expect(add(name_.sheet).disabled).toBe(false);
    name(name_.sheet, '');
    expect(add(name_.sheet).disabled).toBe(true);
    expect(problems(name_.sheet)).toEqual(['Enter a name.']);
    cleanup();
    const url = open();
    name(url.sheet, 'files-probe');
    expect(add(url.sheet).disabled).toBe(true); // the URL untouched and empty
    expect(problems(url.sheet)).toEqual([]);
    type(field(url.sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
    expect(add(url.sheet).disabled).toBe(false);
    type(field(url.sheet, '[data-connector-url-field]'), '');
    expect(add(url.sheet).disabled).toBe(true);
    expect(problems(url.sheet)).toEqual(['Enter the server’s URL.']);
    cleanup();
    const command = open();
    name(command.sheet, 'files-probe');
    choose(command.sheet, 'Local command');
    expect(add(command.sheet).disabled).toBe(true); // the command untouched and empty
    expect(problems(command.sheet)).toEqual([]);
    type(field(command.sheet, '[data-connector-command-field]'), '/opt/x');
    expect(add(command.sheet).disabled).toBe(false);
    type(field(command.sheet, '[data-connector-command-field]'), '');
    expect(add(command.sheet).disabled).toBe(true);
    expect(problems(command.sheet)).toEqual(['Enter the command.']);
  });

  describe('G3: each refusal says why, and Add waits', () => {
    const ready = (sheet: HTMLElement) => {
      name(sheet, 'files-probe');
      type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
      expect(add(sheet).disabled).toBe(false);
    };

    it('a URL that is not http or https with a host', () => {
      const { sheet } = open();
      ready(sheet);
      type(field(sheet, '[data-connector-url-field]'), 'ftp://files.example.test');
      expect(problems(sheet)).toEqual(['Enter an http or https URL.']);
      expect(add(sheet).disabled).toBe(true);
      type(field(sheet, '[data-connector-url-field]'), '');
      expect(problems(sheet)).toEqual(['Enter the server’s URL.']);
    });

    it('a name configured here, or held by MAWS’s own list, with that entry shown; maws and a name the engine reserves; an empty name once typed in', () => {
      const { sheet } = open(env({ configured: { state: 'read', servers: [{ name: 'files-probe', scope: 'local', path: '/cfg/.claude.json', transport: 'stdio' }, { name: 'own-probe', scope: 'app', path: '/maws/settings.json', transport: 'http' }] } }));
      name(sheet, 'files-probe');
      type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
      expect(problems(sheet)).toEqual(['This name is already configured here (local scope, /cfg/.claude.json).']);
      expect(add(sheet).disabled).toBe(true);
      name(sheet, 'own-probe');
      expect(problems(sheet)).toEqual(['This name is already configured here (app scope, /maws/settings.json).']);
      for (const reserved of ['maws', 'workspace']) {
        name(sheet, reserved);
        expect(problems(sheet)).toEqual(['This name is reserved by Claude Code or by MAWS.']);
        expect(add(sheet).disabled).toBe(true);
      }
      name(sheet, 'files probe');
      expect(problems(sheet)).toEqual(['Use letters, digits, hyphens and underscores only.']);
      name(sheet, '');
      expect(problems(sheet)).toEqual(['Enter a name.']);
    });

    it('arguments that end inside a quote show the sentence and no boxes; a value with no name; an empty command once typed in', () => {
      const { sheet } = open();
      name(sheet, 'files-probe');
      choose(sheet, 'Local command');
      type(field(sheet, '[data-connector-command-field]'), '/opt/x');
      expect(add(sheet).disabled).toBe(false);
      type(field(sheet, '[data-connector-args-field]'), '--root "/tmp/my');
      expect(problems(sheet)).toEqual(['The arguments end inside a quote.']);
      expect(sheet.querySelector('[data-connector-arg]')).toBeNull();
      expect(add(sheet).disabled).toBe(true);
      type(field(sheet, '[data-connector-args-field]'), '');
      addRow(sheet, 'Add variable', '', 'value-one');
      expect(problems(sheet)).toEqual(['Enter a name for this variable.']);
      expect(add(sheet).disabled).toBe(true);
      cleanup();
      const remote = open();
      ready(remote.sheet);
      addRow(remote.sheet, 'Add header', '', 'value-one');
      expect(problems(remote.sheet)).toEqual(['Enter a name for this header.']);
      expect(add(remote.sheet).disabled).toBe(true);
      cleanup();
      const command = open();
      choose(command.sheet, 'Local command');
      type(field(command.sheet, '[data-connector-command-field]'), '/opt/x');
      type(field(command.sheet, '[data-connector-command-field]'), '');
      expect(problems(command.sheet)).toEqual(['Enter the command.']);
    });

    it('while what is configured here is read, or could not be read whole, Add waits and says so, with Retry', () => {
      for (const configured of [{ state: 'reading' }, { state: 'partial' }, { state: 'failed', message: 'the engine host is not running' }] as const) {
        const retryServers = vi.fn();
        const { sheet } = open(env({ configured, retryServers }));
        name(sheet, 'files-probe');
        type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
        expect(add(sheet).disabled, configured.state).toBe(true);
        if (configured.state === 'reading') expect(within(sheet).getByRole('status').textContent).toBe('Reading what is configured here…');
        else fireEvent.click(within(sheet).getByRole('button', { name: 'Retry' }));
        if (configured.state !== 'reading') expect(retryServers).toHaveBeenCalledTimes(1);
        cleanup();
      }
    });

    it('names no command and confirms nothing until the engine is resolved', () => {
      const { sheet } = open(env({ engine: { state: 'loading' } }));
      name(sheet, 'files-probe');
      type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
      expect(within(sheet).queryByRole('button', { name: 'Details' })).toBeNull();
      expect(add(sheet).disabled).toBe(true);
    });
  });

  it('G4: the arguments shown split under the field as they are typed, an empty one as (empty); the sentence about arguments always under it', () => {
    const { sheet } = open();
    choose(sheet, 'Local command');
    const args = within(sheet).getByRole('textbox', { name: 'Arguments' });
    expect(args.parentElement!.nextElementSibling!.textContent).toBe('Arguments are shown and saved as typed and are hidden nowhere. Put a secret in Environment.');
    expect(sheet.querySelector('[data-connector-args]')!.textContent).toBe('No arguments');
    type(args as HTMLInputElement, '--root "/tmp/my files" -v');
    expect([...sheet.querySelectorAll('[data-connector-arg]')].map((box) => box.textContent)).toEqual(['--root', '/tmp/my files', '-v']);
    expect(sheet.querySelector('[data-connector-args] p')!.textContent).toBe('3 arguments');
    type(args as HTMLInputElement, "''");
    expect([...sheet.querySelectorAll('[data-connector-arg]')].map((box) => box.textContent)).toEqual(['(empty)']);
    expect(sheet.querySelector('[data-connector-args] p')!.textContent).toBe('1 argument');
    expect(sheet.querySelector('[data-connector-arg]')!.className).toContain('text-fg-muted');
  });

  it('a command holding a space is taken whole, and says so without refusing', () => {
    const { sheet } = open();
    name(sheet, 'files-probe');
    choose(sheet, 'Local command');
    type(field(sheet, '[data-connector-command-field]'), '/Applications/Files Probe/probe');
    expect(sheet.querySelector('[data-connector-command-note]')!.textContent).toBe('Taken whole as the program to run, spaces included. Arguments go in Arguments.');
    expect(add(sheet).disabled).toBe(false);
  });

  it('the secrets sentence while there is a row; the warning directly under "Add to" while the scope is the shared file and a row holds a name or a value', () => {
    const { sheet } = open();
    choose(sheet, 'files-lab, shared in its .mcp.json');
    expect(sheet.querySelector('[data-connector-shared-warning]')).toBeNull();
    const row = addRow(sheet, 'Add header', '', '');
    expect(sheet.querySelector('[data-connector-shared-warning]')).toBeNull(); // an empty row is not sent
    type(row.querySelector('[data-connector-row-name]')!, 'X-Probe-Key');
    const warning = sheet.querySelector('[data-connector-shared-warning]')!;
    expect(warning.textContent).toBe('This file is usually committed with the repository. Write a secret as ${NAME}, with a name of your own, and set NAME under env in ~/.claude/settings.json or in the environment Claude Code starts with.');
    expect(warning.previousElementSibling).toBe(within(sheet).getByRole('group', { name: 'Add to' }));
    choose(sheet, 'files-lab only');
    expect(sheet.querySelector('[data-connector-shared-warning]')).toBeNull();
    choose(sheet, 'files-lab, shared in its .mcp.json');
    choose(sheet, 'Local command'); // the other type's rows are not sent
    expect(sheet.querySelector('[data-connector-shared-warning]')).toBeNull();
    expect(sheet.textContent).not.toContain('Saved in Claude Code’s configuration file as written.');
  });

  it('G7: a name Claude Code sends to a remote server as empty, under the URL and under the header’s row; none for one’s own; none on a local command; Add enabled', () => {
    const { sheet } = open();
    name(sheet, 'files-probe');
    for (const emptied of ['NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'OTEL_EXPORTER_OTLP_HEADERS']) {
      type(field(sheet, '[data-connector-url-field]'), `https://files.example.test/mcp?k=\${${emptied}}`);
      const url = sheet.querySelector('[data-connector-url-field]')!.closest('label')!;
      expect(url.nextElementSibling!.textContent, emptied).toBe(`Claude Code sends ${emptied} to a remote server as empty. Use a name of your own.`);
      expect(add(sheet).disabled).toBe(false);
    }
    type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
    const row = addRow(sheet, 'Add header', 'X-Probe', '${NPM_TOKEN}');
    expect(row.querySelector('[data-connector-sent-empty]')!.textContent).toBe('Claude Code sends NPM_TOKEN to a remote server as empty. Use a name of your own.');
    expect(add(sheet).disabled).toBe(false);
    type(row.querySelector('[data-connector-value]')!, '${MYSERVICE_TOKEN}');
    expect(sheet.querySelector('[data-connector-sent-empty]')).toBeNull();
    choose(sheet, 'Local command');
    type(field(sheet, '[data-connector-command-field]'), '/opt/x');
    addRow(sheet, 'Add variable', 'NPM_TOKEN', '${NPM_TOKEN}');
    expect(sheet.querySelector('[data-connector-sent-empty]')).toBeNull();
  });

  describe('Details: the command with ••• in each value slot, and the file it changes', () => {
    const VALUES = ['value-one', 'value-two', 'value-three'];
    const holds = (text: string) => VALUES.some((value) => text.includes(value));
    // every text and attribute of the sheet but the value fields' own
    const outsideValueFields = (sheet: HTMLElement) => {
      const found: string[] = [];
      for (const element of [sheet, ...sheet.querySelectorAll('*')]) {
        if (element.matches('[data-connector-value]')) continue;
        for (const attribute of element.attributes) if (holds(attribute.value)) found.push(`${element.tagName} ${attribute.name}`);
        for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE && holds(node.textContent ?? '')) found.push(`${element.tagName} text`);
      }
      return found;
    };

    it('a remote entry: no text and no attribute outside the value fields holds a value; ••• in its place; the file', () => {
      const { sheet } = open();
      name(sheet, 'files-probe');
      type(field(sheet, '[data-connector-url-field]'), 'https://files.example.test/mcp');
      addRow(sheet, 'Add header', 'X-Probe-Key', 'value-one');
      addRow(sheet, 'Add header', 'X-Probe-Mode', 'value-two');
      choose(sheet, 'files-lab, shared in its .mcp.json');
      openDetails(sheet);
      expect(outsideValueFields(sheet)).toEqual([]);
      expect([...sheet.querySelectorAll<HTMLInputElement>('[data-connector-value]')].map((input) => input.value)).toEqual(['value-one', 'value-two']);
      const argv = JSON.parse(sheet.querySelector('[data-plugins-argv]')!.getAttribute('data-plugins-argv')!) as string[];
      expect(argv).toEqual(['mcp', 'add-json', 'files-probe', '{"type":"http","url":"https://files.example.test/mcp","headers":{"X-Probe-Key":"•••","X-Probe-Mode":"•••"}}', '--scope', 'project']);
      expect(sheet.querySelector('[data-plugins-argv]')!.textContent).toBe(`claude mcp add-json files-probe '{"type":"http","url":"https://files.example.test/mcp","headers":{"X-Probe-Key":"•••","X-Probe-Mode":"•••"}}' --scope project`);
      expect(sheet.querySelector('[data-connector-writes]')!.textContent).toBe('/work/files-lab/.mcp.json');
    });

    it('a local entry: the same of its variables, the arguments shown as typed', () => {
      const { sheet } = open();
      name(sheet, 'files-probe');
      choose(sheet, 'Local command');
      type(field(sheet, '[data-connector-command-field]'), '/opt/probe/bin/files-probe');
      type(field(sheet, '[data-connector-args-field]'), '--root /tmp/files');
      addRow(sheet, 'Add variable', 'MODE', 'value-three');
      openDetails(sheet);
      expect(outsideValueFields(sheet)).toEqual([]);
      expect(sheet.querySelector('[data-plugins-argv]')!.textContent).toBe(`claude mcp add-json files-probe '{"type":"stdio","command":"/opt/probe/bin/files-probe","args":["--root","/tmp/files"],"env":{"MODE":"•••"}}' --scope user`);
      expect(sheet.querySelector('[data-connector-writes]')!.textContent).toBe('/cfg/.claude.json');
    });

    it('the command is one unbreakable unit per piece between spaces and commas, a break after each, and each ••• one element that does not wrap', () => {
      const { sheet } = open();
      name(sheet, 'files-probe');
      choose(sheet, 'Local command');
      type(field(sheet, '[data-connector-command-field]'), '/opt/probe/bin/files-probe');
      type(field(sheet, '[data-connector-args-field]'), '--port 7000');
      addRow(sheet, 'Add variable', 'MODE', 'value-one');
      addRow(sheet, 'Add variable', 'LEVEL', 'value-two');
      openDetails(sheet);
      const code = sheet.querySelector('[data-plugins-argv]')!;
      const units = [...code.querySelectorAll('[data-command-unit]')];
      expect(units.map((unit) => unit.textContent)).toEqual(['claude', 'mcp', 'add-json', 'files-probe', `'{"type":"stdio",`, `"command":"/opt/probe/bin/files-probe",`, `"args":["--port",`, `"7000"],`, `"env":{"MODE":"•••",`, `"LEVEL":"•••"}}'`, '--scope', 'user']);
      for (const unit of units) {
        expect(unit.className).toContain('inline-block'); // one unit: it moves to the next line whole, breaking inside only when longer than the line
        expect(unit.textContent).not.toMatch(/ /);
        const next = unit.nextSibling;
        if (unit.textContent!.endsWith(',')) expect(next?.nodeName).toBe('WBR');
        else if (unit !== units.at(-1)) expect(next?.textContent).toBe(' ');
      }
      const masks = [...code.querySelectorAll('[data-command-mask]')];
      expect(masks.map((mask) => mask.textContent)).toEqual(['•••', '•••']);
      for (const mask of masks) expect(mask.className).toContain('whitespace-nowrap');
      expect(code.className).not.toContain('break-all');
    });
  });
});
