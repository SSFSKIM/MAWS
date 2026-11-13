// U11a M10 (l8-settings-06, A7; the execution document's Interfaces §G, "Search"): the search over the row table, the
// state each drawn row shows now, the keyboard's bindings and the Org page's group headings. Its four rules: a result
// never names text the page will not show in its present state; a result is the row's name with its section under it;
// a row is not matched by its group's name; and (in the view) the chosen row itself takes the keyboard.
import { describe, expect, it } from 'vitest';
import { SETTINGS_ROWS } from './rows';
import { searchSettings, type SettingsResult } from './search';

// The page as it opens with the defaults: every row no other reveals, in its first state, and the memory budget on, so
// its two rows are drawn too.
const DEFAULT_PAGE: Readonly<Record<string, string>> = {
  ...Object.fromEntries(SETTINGS_ROWS.filter((row) => row.revealedBy === undefined).map((row) => [row.id, Object.keys(row.states)[0]!])),
  'supervisor.memoryBudget': 'on',
  'supervisor.limit': 'sized',
  'supervisor.stateful': 'default',
};
const page = (states: Readonly<Record<string, string>> = {}, without: readonly string[] = []): ReadonlyMap<string, string> =>
  new Map(Object.entries({ ...DEFAULT_PAGE, ...states }).filter(([id]) => !without.includes(id)));
const BINDINGS = [
  { id: 'session.new', title: 'New chat' },
  { id: 'tab.close', title: 'Close tab' },
];
const ORG_GROUPS = ['You', 'People', 'Machines', 'Org'];

const search = (query: string, shown = page(), orgGroups = ORG_GROUPS, bindings = BINDINGS): SettingsResult[] => searchSettings(query, { rows: SETTINGS_ROWS, shown, bindings, orgGroups });
// each result as it reads: its name, then what stands under it
const read = (query: string, shown = page(), orgGroups = ORG_GROUPS) => search(query, shown, orgGroups).map((r) => `${r.name} · ${r.under}`);
const ids = (query: string, shown = page()) => search(query, shown).map((r) => r.id);

describe('Search settings', () => {
  it('lists the rows of A7’s four queries, each the row’s name with its section under it; "mcp" also finds the Customize link', () => {
    expect(read('mcp')).toEqual(['MCP servers · Sessions', 'Stateful MCP servers · Supervisor', 'Customize · Plugins, skills and connectors']);
    expect(read('hook')).toEqual(['Hooks in sessions · Sessions']);
    expect(read('theme')).toEqual(['Theme · Appearance']);
    expect(read('shortcut')).toEqual(['Key bindings · Keyboard', 'Shortcut · Voice']);
    expect(search('theme')).toEqual([{ id: 'appearance.theme', name: 'Theme', under: 'Appearance', target: 'appearance.theme', openMore: false }]);
  });

  // UX wave U7b (O-47): the usage panel is one declared row of Usage, so the search finds it and lands on the section
  it('finds Usage and its panel, "Claude accounts", by the section’s name and the row’s words', () => {
    expect(read('usage')).toEqual(['Direct login · Gateway', 'Usage · Section', 'Claude accounts · Usage']); // Direct login's line names usage
    expect(search('usage').find((r) => r.id === 'usage.accounts')).toEqual({ id: 'usage.accounts', name: 'Claude accounts', under: 'Usage', target: 'usage.accounts', openMore: false });
    expect(ids('codex')).toEqual(['usage.accounts']);
    expect(ids('limit')).toContain('usage.accounts');
  });

  it('finds a row by the other words people use', () => {
    expect(read('dark')).toEqual(['Theme · Appearance']);
    expect(ids('integrations')).toEqual(['sessions.mcpServers']);
    expect(ids('hotkey')).toEqual(['keyboard.bindings']);
    expect(ids('marketplace')).toEqual(['customize']);
    expect(ids('relay')).toEqual(expect.arrayContaining(['gateway.defaultRoute', 'gateway.policy', 'gateway.offerDirect', 'gateway.directLogin', 'gateway.relay']));
  });

  it('requires every word of the query and ignores case', () => {
    expect(ids('MEMORY Budget')).toEqual(['supervisor.memoryBudget']);
    expect(ids('memory zebra')).toEqual([]);
    expect(ids('mcp stateful')).toEqual(['supervisor.stateful']);
    expect(search('')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });

  it('lists a section by its name and an Org group by its heading, but never the Org page’s own group headed Org', () => {
    expect(search('people')).toEqual([{ id: 'org:People', name: 'People', under: 'Org', target: 'org:People', openMore: false }]);
    expect(search('org').filter((r) => r.name === 'Org')).toEqual([{ id: 'section:org', name: 'Org', under: 'Section', target: 'section:org', openMore: false }]);
    expect(search('Supervisor')[0]).toEqual({ id: 'section:supervisor', name: 'Supervisor', under: 'Section', target: 'section:supervisor', openMore: false });
    // a group the page does not draw (a Mac not in an org) is no result
    expect(read('people', page(), ['Org'])).toEqual([]);
  });

  it('never matches a row by its group’s name: "keyboard" lists the section and its two rows, not every binding', () => {
    expect(read('sessions & engine')).toEqual([]);
    expect(read('keyboard')).toEqual(['Keyboard · Section', 'Key bindings · Keyboard', 'Reset to defaults · Keyboard']);
  });

  it('finds a key binding by its action’s title alone, under Keyboard, while the bindings are drawn', () => {
    expect(search('new chat')).toContainEqual({ id: 'binding:session.new', name: 'New chat', under: 'Keyboard', target: 'binding:session.new', openMore: false });
    expect(ids('close tab')).toContain('binding:tab.close');
    expect(ids('keyboard close')).not.toContain('binding:tab.close'); // not by its section's name
    expect(search('new chat', page({}, ['keyboard.bindings'])).map((r) => r.id)).not.toContain('binding:session.new');
  });

  it('finds a word behind the More a row shows now and opens that More; never a word only in another state’s More', () => {
    // the installed binary's More names the shell's PATH; a chosen binary's does not
    expect(search('PATH').filter((r) => r.id === 'engine.binary')).toEqual([{ id: 'engine.binary', name: 'Binary', under: 'Engine', target: 'engine.binary', openMore: true }]);
    expect(ids('PATH', page({ 'engine.binary': 'chosen' }))).not.toContain('engine.binary');
    expect(search('binary').find((r) => r.id === 'engine.binary')?.openMore).toBe(false);
    expect(search('released').find((r) => r.id === 'supervisor.limit')).toMatchObject({ openMore: true });
    // a word on the line and one behind More together still need the More
    expect(search('default released').find((r) => r.id === 'supervisor.limit')).toMatchObject({ openMore: true });
  });

  it('finds a row that is not drawn as the row that reveals it, by its label and keywords only', () => {
    const off = page({ 'supervisor.memoryBudget': 'off' }, ['supervisor.limit', 'supervisor.stateful']);
    expect(search('stateful', off)).toEqual([{ id: 'supervisor.memoryBudget', name: 'Memory budget', under: 'Supervisor', target: 'supervisor.memoryBudget', openMore: false }]);
    expect(ids('memory limit', off)).toEqual(['supervisor.memoryBudget']);
    expect(ids('released', off)).toEqual([]); // the hidden Limit's own More is not on the page
    expect(ids('RAM', off)).toEqual(['supervisor.memoryBudget']); // one result, though both carry the word
  });

  it('finds a repeating row once by its declared label, landing on its first item, or on the row that reveals it when it has none', () => {
    const populated = page({ 'browser.importedProfile': 'default', 'browser.extension': 'default' });
    expect(search('extensions', populated).filter((r) => r.id === 'browser.extension')).toEqual([{ id: 'browser.extension', name: 'Extensions', under: 'Browser', target: 'browser.extension', openMore: false }]);
    const imported = (shown: ReadonlyMap<string, string>) => search('imported chrome profile', shown).filter((r) => r.id === 'browser.importedProfile');
    expect(imported(populated)).toEqual([{ id: 'browser.importedProfile', name: 'Imported Chrome profile', under: 'Browser', target: 'browser.importedProfile', openMore: false }]);
    expect(search('extensions').filter((r) => r.id === 'browser.extension')).toEqual([{ id: 'browser.extension', name: 'Extensions', under: 'Browser', target: 'browser.chromeProfile', openMore: false }]);
    expect(imported(page())).toEqual([{ id: 'browser.importedProfile', name: 'Imported Chrome profile', under: 'Browser', target: 'browser.chromeProfile', openMore: false }]);
  });

  it('reads the words around a value in a line, never the place’s name', () => {
    const imported = page({ 'browser.importedProfile': 'default' });
    expect(ids('summary', imported)).not.toContain('browser.importedProfile');
    expect(ids('size')).not.toContain('supervisor.limit');
    expect(ids('physical memory')).toContain('supervisor.limit');
  });

  it('stands the results in the page’s order, a section’s own result before its rows', () => {
    const order = ids('engine');
    expect(order.indexOf('browser.search')).toBeGreaterThanOrEqual(0); // "Search engine", in Browser, before Engine
    expect(order.indexOf('browser.search')).toBeLessThan(order.indexOf('sessions.autoFallback'));
    expect(order.indexOf('sessions.autoFallback')).toBeLessThan(order.indexOf('section:engine'));
    expect(order.slice(order.indexOf('section:engine'), order.indexOf('section:engine') + 4)).toEqual(['section:engine', 'engine.binary', 'engine.update', 'engine.configHome']);
    expect(read('mcp').at(-1)).toBe('Customize · Plugins, skills and connectors'); // the index's last link, last
  });
});
