import { describe, expect, it } from 'vitest';
import type { Catalog, Route } from 'desk-hub/protocol';
import { parseCommand } from './command';
import { commandRoute, slashItems } from './catalog';
const run: Route = { class: 'run', enabled: true, measured: 'M' };
const prompt: Route = { class: 'run-prompt', enabled: true, measured: 'M' };
export const catalog: Catalog = { fingerprint: 'fixture', measured: '2.1.307', models: { options: ['default'], aliases: {} }, commands: [
  { name: 'color', description: 'Set a color', source: 'builtin', route: { ...run, forms: { args: 'required' } } },
  { name: 'mcp', description: 'Manage servers', source: 'builtin', route: { class: 'panel', to: 'read mcp', enabled: true, measured: 'M' }, withArgs: { ...run, forms: { args: 'required', pattern: '(enable|disable|reconnect) \\S+', hint: 'enable|disable|reconnect <server>' }, outlives: 'saved on <machine>' } },
  { name: 'goal', description: 'Pursue a goal', source: 'builtin', route: { class: 'panel', enabled: true, measured: 'M' }, withArgs: { ...run, forms: { args: 'required', pattern: 'clear', hint: 'Interrupt stops a running goal' }, otherwise: prompt } },
  { name: 'probe:prompt (MCP)', description: 'A remote prompt', source: 'mcp', route: prompt },
  { name: 'execspec', description: 'Execute a spec', source: 'skill', route: prompt },
  { name: 'model', description: 'Choose model', source: 'builtin', route: { class: 'routed', to: 'model', reason: 'use Model instead: /model saves a default for new sessions', enabled: true, measured: 'M' } },
  { name: 'exit', description: 'Exit session', source: 'builtin', route: { ...run, confirm: true } },
] };
describe('advertised command forms', () => {
  it('parses the exact longest listed name, including the MCP suffix, never stripping it', () => {
    expect(parseCommand('/probe:prompt (MCP) explain', catalog)).toEqual({ name: 'probe:prompt (MCP)', args: 'explain' });
    expect(parseCommand('/probe:prompt (MCP)', catalog)).toEqual({ name: 'probe:prompt (MCP)', args: '' });
    expect(parseCommand('/Users/me/file', catalog)).toBeNull();
  });
  it('takes bare, with-args and otherwise from the catalog, refusing unknown names and bad forms locally', () => {
    expect(commandRoute(catalog, 'mcp', '', 'mini')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('panel') });
    expect(commandRoute(catalog, 'mcp', 'disable server', 'mini')).toMatchObject({ kind: 'command', route: { class: 'run', outlives: 'saved on mini' } });
    expect(commandRoute(catalog, 'mcp', 'bad', 'mini')).toMatchObject({ kind: 'unavailable' });
    expect(commandRoute(catalog, 'goal', 'clear', 'mini')).toMatchObject({ kind: 'command', route: { class: 'run' } });
    expect(commandRoute(catalog, 'goal', 'finish tests', 'mini')).toMatchObject({ kind: 'command', route: { class: 'run-prompt' } });
    expect(commandRoute(catalog, 'missing', '', 'mini')).toEqual({ kind: 'unavailable', reason: 'not a command this session knows' });
    expect(commandRoute(catalog, 'color', '', 'mini')).toMatchObject({ kind: 'unavailable' });
    expect(commandRoute(catalog, 'model', '', 'mini')).toMatchObject({ kind: 'widget', name: 'model' });
    expect(commandRoute(catalog, 'model', 'sonnet', 'mini')).toMatchObject({ kind: 'unavailable', reason: 'use Model instead: /model saves a default for new sessions' });
    expect(commandRoute(catalog, 'compact', 'keep this plan', 'mini')).toMatchObject({ kind: 'unavailable' });
    expect(commandRoute(catalog, 'exit', '', 'mini')).toMatchObject({ kind: 'command', route: { confirm: true } });
  });
  it('offers argument forms without executing panels and retains source grouping and downgrade reasons', () => {
    const items = slashItems(catalog, 'mini', null);
    expect(items.find((i) => i.name === 'mcp')).toMatchObject({ action: { kind: 'text' }, argumentHint: 'enable|disable|reconnect <server>' });
    expect(items.find((i) => i.name === 'execspec')).toMatchObject({ origin: 'skills' });
    expect(items.find((i) => i.name === 'probe:prompt (MCP)')).toMatchObject({ origin: 'plugins' });
    expect(slashItems(catalog, 'mini', 'update mini').find((i) => i.name === 'color')).toMatchObject({ action: { kind: 'unavailable', hint: 'update mini' } });
    expect(slashItems(null, 'mini', 'update mini').map((i) => i.name)).toEqual(['model', 'compact']);
  });
});
