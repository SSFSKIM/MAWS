import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_CATALOG, projectCatalog, type SessionCatalog } from '../../stores/catalog';
import { atItems, slashItems, type SlashItem } from './items';
import { paletteRows, rankItems, rememberChosen, resetChosen, ROW_LIMIT } from './rank';
import { registerSlashWidget, registeredWidgetNames, WIDGET_COMMANDS } from './widgets';

// The engine's catalogue of `pass2/auto-routed` as C3's `session.catalog` answers it: the initialize response's commands
// and agents (seq 4) and the first system/init's skills and terminal-only commands (seq 9).
function autoRouted() {
  const rows = readFileSync(join(__dirname, '../../../../../spikes/protocol-probe/fixtures/pass2/auto-routed.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { seq: number; frame: Record<string, unknown> });
  const init = rows.find((r) => r.seq === 4)!.frame as { response: { response: { commands: unknown[]; agents: unknown[] } } };
  const sys = rows.find((r) => r.seq === 9)!.frame as { skills: unknown[]; terminal_slash_commands: unknown[] };
  return projectCatalog('L1', { commands: init.response.response.commands, agents: init.response.response.agents, skills: sys.skills, terminalSlashCommands: sys.terminal_slash_commands, revision: 2 });
}

// UX wave U4a: the catalogue of `uxwave/u4p1-a-seeded-1` (engine 2.1.322): the initialize response's commands (seq 4)
// and the first system/init's skills and terminal-only commands (seq 17).
function seeded() {
  const rows = readFileSync(join(__dirname, '../../../../../spikes/protocol-probe/fixtures/uxwave/u4p1-a-seeded-1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { seq: number; frame: Record<string, unknown> });
  const init = rows.find((r) => r.seq === 4)!.frame as { response: { response: { commands: unknown[]; agents: unknown[] } } };
  const sys = rows.find((r) => r.seq === 17)!.frame as { skills: unknown[]; terminal_slash_commands: unknown[] };
  return projectCatalog('L3', { commands: init.response.response.commands, agents: init.response.response.agents, skills: sys.skills, terminalSlashCommands: sys.terminal_slash_commands, revision: 2 });
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

  // UX wave U4a (decision 17): no `__` name, no "(removed)" entry MAWS draws no panel for, none of MAWS's window actions
  it('marks origins and applies one dispatch rule: a panel, else headless text, else unavailable; never a hidden name', () => {
    const items = slashItems(autoRouted(), registeredWidgetNames());
    expect(byName(items, 'compact')).toMatchObject({ origin: 'engine', action: { kind: 'text' } });
    expect(byName(items, 'model')).toMatchObject({ origin: 'engine', action: { kind: 'text' } });
    expect(byName(items, 'doctor')).toMatchObject({ origin: 'engine', action: { kind: 'unavailable', hint: 'Terminal only' } }); // W2: the engine runs it only in its terminal
    expect(byName(items, 'permissions')).toMatchObject({ origin: 'widget', action: { kind: 'unavailable', hint: 'Not available here' } }); // W2: no host registered the widget
    // every declared widget name the engine does not hide is an item, whether or not the engine lists it
    for (const w of WIDGET_COMMANDS.filter((w) => w.name !== 'agents')) expect(items.some((i) => i.name === w.name), w.name).toBe(true);
    expect(items.filter((i) => i.origin === 'widget').map((i) => i.name).sort()).toEqual(['btw' /* E3 */, 'diff', 'export', 'fork' /* U4a */, 'hooks', 'memory', 'permissions', 'plugins', 'resume', 'rewind' /* W3 */, 'sandbox', 'skills', 'status']);
    expect(items.some((i) => i.name.startsWith('__'))).toBe(false); // `__remote-workflow`
    expect(items.some((i) => i.name === 'agents')).toBe(false); // the engine's "(removed) …", and no panel registered
    expect(items.some((i) => i.name === 'split' || i.name === 'new-chat')).toBe(false); // ⌘K's
    expect(new Set(items.map((i) => i.origin))).toEqual(new Set(['engine', 'widget']));
  });

  it('opens a registered widget for its name whatever the origin, as a row of MAWS’s panels', () => {
    for (const name of ['model', 'compact', 'permissions', 'reload-plugins', 'agents'] as const) offs.push(registerSlashWidget(name, { title: name, component: Widget }));
    const items = slashItems(autoRouted(), registeredWidgetNames());
    // E11 §2.2: the engine's terminal-only /reload-plugins is MAWS's action once its widget is registered
    for (const name of ['model', 'compact', 'permissions', 'reload-plugins']) expect(byName(items, name)).toMatchObject({ origin: 'widget', action: { kind: 'widget' } });
    // the engine lists /agents as "(removed) …" and MAWS draws it: listed once, as MAWS's, with the panel's own words
    expect(items.filter((i) => i.name === 'agents')).toEqual([{ name: 'agents', title: '/agents', description: 'Browse and manage agents', argumentHint: null, origin: 'widget', action: { kind: 'widget' } }]);
    expect(items.filter((i) => i.name === 'model')).toHaveLength(1);
    offs.splice(0).forEach((off) => off());
    expect(byName(slashItems(autoRouted(), registeredWidgetNames()), 'model')).toMatchObject({ origin: 'engine', action: { kind: 'text' } });
  });

  it('greys a panel the session cannot act through here with the reason it is given', () => {
    const items = slashItems(autoRouted(), new Set(['fork', 'rewind']), { fork: 'Not on another machine yet: forking a session' });
    expect(byName(items, 'fork')).toMatchObject({ origin: 'widget', argumentHint: '[prompt]', action: { kind: 'unavailable', hint: 'Not on another machine yet: forking a session' } });
    expect(byName(items, 'rewind').action).toEqual({ kind: 'widget' });
  });

  // UX wave U11a (§C, "Names"): `/mcp` reads as the dialog it opens, in a started chat (whose catalogue lists the engine's
  // own description) and before the first message alike; every other name keeps the engine's description
  it('describes /mcp in MAWS’s words in a started and an unstarted chat', () => {
    const catalog = autoRouted();
    expect(catalog.commands.find((c) => c.name === 'mcp')?.description).toBe('Manage MCP servers'); // the engine's own
    const started = slashItems(catalog, new Set());
    expect(byName(started, 'mcp')).toMatchObject({ origin: 'engine', description: 'Connectors in this chat (MCP servers)' });
    expect(byName(started, 'compact').description).toBe(catalog.commands.find((c) => c.name === 'compact')!.description);
    expect(byName(slashItems(EMPTY_CATALOG, new Set()), 'mcp')).toMatchObject({ origin: 'widget', description: 'Connectors in this chat (MCP servers)' });
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
    const items = slashItems(c, new Set());
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
  // UX wave U4a (decision 17 e): ties in the order the list gives, so a typed name keeps the order of nothing typed
  it('orders exact, prefix, substring, subsequence, then a description word; ties in list order', () => {
    const items = slashItems(autoRouted(), new Set());
    const ranked = rankItems('mo', items).map((i) => `${i.origin}:${i.name}`);
    // `model` by prefix, then the names holding `mo` (memory: me-mo-ry), then names holding m…o apart, each tier in the
    // list's order: the declared `memory` stands at the list's end and still comes before every subsequence match
    expect(ranked.slice(0, 4)).toEqual(['engine:model', 'engine:auto-mode-setup', 'widget:memory', 'engine:fewer-permission-prompts']);
    expect(ranked).not.toContain('engine:mcp'); // `mcp` holds no `o` and its description ("Connectors in this chat (MCP servers)") no word starting `mo`
    expect(ranked.indexOf('engine:fast')).toBeGreaterThan(ranked.indexOf('widget:memory')); // a description word after every name
    expect(rankItems('mo', items)).toEqual(rankItems('mo', items)); // pure
  });

  it('boosts a recently chosen name by one tier', () => {
    const items = slashItems(autoRouted(), new Set());
    const before = rankItems('mo', items).map((i) => i.name);
    expect(before.indexOf('memory')).toBeGreaterThan(1); // a substring match, after the prefix `model`
    rememberChosen('memory');
    // now in the prefix tier, beside `model`; the engine's entries come first in the list, so `model` stays first
    expect(rankItems('mo', items).map((i) => i.name).slice(0, 2)).toEqual(['model', 'memory']);
  });

  it('keeps the whole list for an empty query, recently chosen first', () => {
    const items = slashItems(autoRouted(), new Set());
    rememberChosen('usage');
    const ranked = rankItems('', items);
    expect(ranked).toHaveLength(items.length);
    expect(ranked[0].name).toBe('usage');
  });
});

// UX wave U4a (decision 17 h; the owner's answer to "/ order", "MAWS's panels first"): with nothing typed, the panels this
// session has in the order WIDGET_COMMANDS declares them, then the catalogue's entries in its order (built in, then
// skills, plugin commands and custom commands), then what cannot run from here, which is left out until typed; the cut
// at 40 after all of that.
describe('the order with nothing typed', () => {
  const PANELS = WIDGET_COMMANDS.map((w) => w.name);
  const everyPanel = new Set<string>(PANELS);
  const names = (items: SlashItem[]) => items.map((i) => i.name);

  it('opens on every panel in its declared order, /agents once and /fork after /rewind, then the engine’s entries in its order', () => {
    for (const catalog of [autoRouted(), seeded()]) {
      const items = slashItems(catalog, everyPanel);
      const rows = paletteRows('', items);
      expect(rows).toHaveLength(ROW_LIMIT);
      expect(names(rows.slice(0, PANELS.length))).toEqual(PANELS);
      expect(rows.slice(0, PANELS.length).every((r) => r.origin === 'widget' && r.action.kind === 'widget')).toBe(true);
      expect(PANELS.indexOf('fork')).toBe(PANELS.indexOf('rewind') + 1);
      expect(names(items).filter((n) => n === 'agents')).toHaveLength(1);
      // then the engine's entries in its order, the panels and the hidden ones left out: its eighteen bundled skills
      // come first, so the sixteen rows after the panels are those of them that can run here (`doctor` is terminal-only)
      const engine = catalog.commands.map((c) => c.name).filter((n) => !everyPanel.has(n) && !n.startsWith('__') && !catalog.terminalOnly.includes(n));
      expect(names(rows.slice(PANELS.length))).toEqual(engine.slice(0, ROW_LIMIT - PANELS.length));
      expect(rows.at(-1)!.name).toBe('run-skill-generator');
      expect(names(rows)).not.toContain('doctor');
    }
  });

  it('puts the engine’s built-in commands first, then skills, plugin commands and custom commands, each in the catalogue’s order', () => {
    const c = projectCatalog('L', {
      commands: [
        { name: 'mine', description: 'a user command', argumentHint: '', builtin: false },
        { name: 'tool:go', description: 'a plugin command', argumentHint: '', builtin: false },
        { name: 'zeta', description: 'built in', argumentHint: '', builtin: true },
        { name: 'skilly', description: 'a skill', argumentHint: '', builtin: false },
        { name: 'alpha', description: 'built in', argumentHint: '', builtin: true },
        { name: 'another', description: 'a user command', argumentHint: '', builtin: false },
        { name: 'model', description: 'the engine’s own', argumentHint: '<model>', builtin: true },
      ],
      agents: [], skills: ['skilly'], terminalSlashCommands: [], revision: 1,
    });
    expect(names(paletteRows('', slashItems(c, new Set(['btw', 'model']))))).toEqual(['model', 'btw', 'zeta', 'alpha', 'skilly', 'tool:go', 'mine', 'another']);
    // a panel's row reads the panel's words, not the engine's
    expect(byName(slashItems(c, new Set(['model'])), 'model')).toMatchObject({ description: 'Choose the model for this session', argumentHint: null, origin: 'widget' });
  });

  it('on a terminal session: the six panels its bridge backs, then the bridge’s catalogue in its order; a declared name with no panel there absent until typed', () => {
    const backed = new Set(['model', 'effort', 'fast', 'compact', 'mcp', 'btw']);
    const unavailable: Record<string, string> = {};
    for (const { name } of WIDGET_COMMANDS) if (!backed.has(name) && name !== 'context') unavailable[name] = 'Not in a terminal session';
    unavailable['ship'] = 'Opens a panel in the terminal';
    const catalog: SessionCatalog = {
      ...EMPTY_CATALOG,
      launchId: 'lane-a:x',
      revision: 1,
      commands: [
        { name: 'review', description: 'Review the change', argumentHint: null, builtin: true },
        { name: 'context', description: 'Show context usage', argumentHint: null, builtin: true }, // a declared name the bridge runs
        { name: 'ship', description: 'Ship it', argumentHint: null, builtin: true },
        { name: 'compact', description: 'Compact', argumentHint: null, builtin: true },
        { name: 'notes', description: 'Take notes', argumentHint: null, builtin: false },
      ],
      unavailable,
    };
    const items = slashItems(catalog, backed);
    expect(names(paletteRows('', items))).toEqual(['model', 'effort', 'fast', 'mcp', 'compact', 'btw', 'review', 'context', 'notes']);
    expect(byName(items, 'context')).toMatchObject({ origin: 'engine', action: { kind: 'text' } });
    const typed = paletteRows('permissions', items);
    expect(typed.map((r) => [r.name, r.action])).toEqual([['permissions', { kind: 'unavailable', hint: 'Not in a terminal session' }]]);
    expect(paletteRows('fork', items)[0]).toMatchObject({ name: 'fork', action: { kind: 'unavailable', hint: 'Not in a terminal session' } });
    expect(paletteRows('ship', items)[0]).toMatchObject({ name: 'ship', action: { kind: 'unavailable', hint: 'Opens a panel in the terminal' } });
  });

  it('leaves out a row that cannot run while nothing is typed, and lists it greyed once the typed text matches its name', () => {
    const items = slashItems(autoRouted(), new Set());
    expect(names(paletteRows('', items))).not.toContain('doctor');
    expect(names(paletteRows('', items))).not.toContain('permissions');
    expect(paletteRows('doc', items)[0]).toMatchObject({ name: 'doctor', action: { kind: 'unavailable', hint: 'Terminal only' } });
    expect(paletteRows('permis', items).map((r) => r.name)).toContain('permissions');
    expect(paletteRows('remote', items).map((r) => r.name)).not.toContain('__remote-workflow');
  });

  it('never reveals a row that cannot run for a word of its description alone, where a row that can run still matches so', () => {
    const items = slashItems(autoRouted(), new Set());
    // the declared /fork, /rewind and /export (no panel registered) speak of "the conversation"; the engine's /compact too
    const rows = paletteRows('conversation', items).map((r) => r.name);
    expect(rows).toContain('compact');
    for (const name of ['fork', 'rewind', 'export']) expect(rows, name).not.toContain(name);
    // /fork refused on another machine, every other panel drawn: the same word lists /rewind and /export, not /fork
    const far = paletteRows('conversation', slashItems(seeded(), everyPanel, { fork: 'Not on another machine yet: forking a session' })).map((r) => r.name);
    expect(far).toEqual(expect.arrayContaining(['rewind', 'export']));
    expect(far).not.toContain('fork');
    expect(paletteRows('fo', slashItems(seeded(), everyPanel, { fork: 'Not on another machine yet: forking a session' })).map((r) => r.name)).toContain('fork'); // by its name
  });

  it('keeps a name chosen earlier in this run first with nothing typed', () => {
    const items = slashItems(seeded(), everyPanel);
    rememberChosen('clear');
    const rows = paletteRows('', items);
    expect(names(rows.slice(0, 3))).toEqual(['clear', 'model', 'effort']);
    expect(rows).toHaveLength(ROW_LIMIT);
  });
});
