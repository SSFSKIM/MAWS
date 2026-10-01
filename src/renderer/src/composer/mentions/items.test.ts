import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectCatalog } from '../../stores/catalog';
import { atItems, mawsItems, slashItems, type SlashItem } from './items';
import { rankItems, rememberChosen, resetChosen } from './rank';
import { registerSlashWidget, registeredWidgetNames, WIDGET_COMMANDS } from './widgets';

// The engine's catalogue of `pass2/auto-routed` as C3's `session.catalog` answers it: the initialize response's commands
// and agents (seq 4) and the first system/init's skills and terminal-only commands (seq 9).
function autoRouted() {
  const rows = readFileSync(join(__dirname, '../../../../../spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { seq: number; frame: Record<string, unknown> });
  const init = rows.find((r) => r.seq === 4)!.frame as { response: { response: { commands: unknown[]; agents: unknown[] } } };
  const sys = rows.find((r) => r.seq === 9)!.frame as { skills: unknown[]; terminal_slash_commands: unknown[] };
  return projectCatalog('L1', { commands: init.response.response.commands, agents: init.response.response.agents, skills: sys.skills, terminalSlashCommands: sys.terminal_slash_commands, revision: 2 });
}

const Widget = () => null;
const offs: (() => void)[] = [];
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  resetChosen();
});

const byName = (items: SlashItem[], name: string) => items.find((i) => i.name === name)!;

describe('slash items union the catalogue, the widget catalogue and MAWS actions', () => {
  it('projects the catalogue and drops entries that do not parse', () => {
    const c = autoRouted();
    expect(c.commands).toHaveLength(52);
    expect(c.commands[0]).toEqual({ name: 'deep-research', description: expect.stringContaining('Deep research'), argumentHint: null, builtin: true });
    expect(c.agents).toHaveLength(5);
    expect(c.skills).toHaveLength(18);
    expect(c.terminalOnly).toEqual(['doctor', 'color', 'focus', 'reload-plugins']);
    const odd = projectCatalog('L2', { commands: [{ name: 'ok', description: 'd', argumentHint: '<x>', builtin: false }, { name: 3 }, 'x'], agents: [{}], skills: ['s', 4], terminalSlashCommands: [], revision: 1 });
    expect(odd.commands).toEqual([{ name: 'ok', description: 'd', argumentHint: '<x>', builtin: false }]);
    expect(odd.agents).toEqual([]);
    expect(odd.skills).toEqual(['s']);
  });

  it('marks origins and applies one dispatch rule: widget, else headless text, else unavailable', () => {
    const items = slashItems(autoRouted(), registeredWidgetNames(), mawsItems(() => true));
    expect(byName(items, 'compact')).toMatchObject({ origin: 'engine', action: { kind: 'text' } });
    expect(byName(items, 'model')).toMatchObject({ origin: 'engine', action: { kind: 'text' } });
    expect(byName(items, 'doctor')).toMatchObject({ origin: 'engine', action: { kind: 'unavailable', hint: 'Terminal only' } }); // W2: the engine runs it only in its terminal
    expect(byName(items, 'permissions')).toMatchObject({ origin: 'widget', action: { kind: 'unavailable', hint: 'Not available here' } }); // W2: no host registered the widget
    // every declared widget name is an item, whether or not the engine lists it
    for (const w of WIDGET_COMMANDS) expect(items.some((i) => i.name === w.name)).toBe(true);
    expect(items.filter((i) => i.origin === 'widget').map((i) => i.name).sort()).toEqual(['diff', 'export', 'hooks', 'memory', 'permissions', 'plugins', 'resume', 'sandbox', 'skills', 'status']);
    expect(items.filter((i) => i.origin === 'maws').length).toBeGreaterThan(5);
    expect(byName(items, 'split')).toMatchObject({ origin: 'maws', action: { kind: 'maws', id: 'pane.split' } });
  });

  it('opens a registered widget for its name whatever the origin', () => {
    for (const name of ['model', 'compact', 'permissions'] as const) offs.push(registerSlashWidget(name, { title: name, component: Widget }));
    const items = slashItems(autoRouted(), registeredWidgetNames(), []);
    for (const name of ['model', 'compact', 'permissions']) expect(byName(items, name).action).toEqual({ kind: 'widget' });
    expect(byName(items, 'model').origin).toBe('engine');
    offs.splice(0).forEach((off) => off());
    expect(byName(slashItems(autoRouted(), registeredWidgetNames(), []), 'model').action).toEqual({ kind: 'text' });
  });

  it('classifies custom and plugin commands and skills', () => {
    const c = projectCatalog('L', {
      commands: [
        { name: 'mine', description: 'a user command', argumentHint: '', builtin: false },
        { name: 'tool:go', description: 'a plugin command', argumentHint: '', builtin: false },
        { name: 'skilly', description: 'a skill', argumentHint: '', builtin: false },
      ],
      agents: [], skills: ['skilly'], terminalSlashCommands: [], revision: 1,
    });
    const items = slashItems(c, new Set(), []);
    expect([byName(items, 'mine').origin, byName(items, 'tool:go').origin, byName(items, 'skilly').origin]).toEqual(['custom', 'plugins', 'skills']);
  });

  it('builds the @ groups: agents insert agent mentions, skills insert their invocation', () => {
    const c = autoRouted();
    const items = atItems(c, 'expl');
    expect(items.map((i) => [i.group, i.name])).toEqual([['agents', 'Explore']]);
    expect(atItems(c, 'deep').map((i) => [i.group, i.name])).toEqual([['skills', 'deep-research']]);
  });
});

describe('slash and @ ranking is deterministic', () => {
  it('orders exact, prefix, substring, subsequence, then a description word; ties by origin then name', () => {
    const items = slashItems(autoRouted(), new Set(), mawsItems(() => true));
    const ranked = rankItems('mo', items).map((i) => `${i.origin}:${i.name}`);
    // `model` by prefix, then the names holding `mo` (memory: me-mo-ry), then names holding m…o apart
    expect(ranked.slice(0, 5)).toEqual(['engine:model', 'engine:__remote-workflow', 'engine:auto-mode-setup', 'widget:memory', 'engine:fewer-permission-prompts']);
    expect(ranked).not.toContain('engine:mcp'); // `mcp` holds no `o` and its description ("Manage MCP servers") no word starting `mo`
    // then the description-only matches, a MAWS action (matched by its description alone) last
    expect(ranked.indexOf('engine:fast')).toBeGreaterThan(ranked.indexOf('widget:memory'));
    expect(ranked.at(-1)).toBe('maws:overview');
    expect(rankItems('mo', items)).toEqual(rankItems('mo', [...items].reverse()));
  });

  it('boosts a recently chosen name by one tier', () => {
    const items = slashItems(autoRouted(), new Set(), []);
    expect(rankItems('mo', items).map((i) => i.name).indexOf('memory')).toBe(3); // a substring match, after its Engine peers
    rememberChosen('memory');
    // now in the prefix tier, beside `model` and after it by origin
    expect(rankItems('mo', items).map((i) => i.name).slice(0, 3)).toEqual(['model', 'memory', '__remote-workflow']);
  });

  it('keeps the whole list for an empty query, recently chosen first', () => {
    const items = slashItems(autoRouted(), new Set(), []);
    rememberChosen('usage');
    const ranked = rankItems('', items);
    expect(ranked).toHaveLength(items.length);
    expect(ranked[0].name).toBe('usage');
  });
});
