// U11a M10 (l8-settings-06, A7; the execution document's Interfaces §G, "Search"): the search over the row table, the
// state each drawn row shows now, the keyboard's bindings and the Org page's group headings. Its four rules: a result
// never names text the page will not show in its present state; a result is the row's name with its section under it;
// a row is not matched by its group's name; and (in the view) the chosen row itself takes the keyboard. The word cut
// (G13 to G15, G9): a row's note is on the page (it opens when the landing gives the row the keyboard), so its words
// find the row; a whole section's result is its name alone; a row whose label the cut changed is found by its old one.
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
// each result as it reads: its name, then what stands under it (a section's, nothing)
const read = (query: string, shown = page(), orgGroups = ORG_GROUPS) => search(query, shown, orgGroups).map((r) => (r.under === null ? r.name : `${r.name} · ${r.under}`));
const ids = (query: string, shown = page()) => search(query, shown).map((r) => r.id);

describe('Search settings', () => {
  it('lists the rows of A7’s four queries, each the row’s name with its section under it; "mcp" also finds the Customize link', () => {
    expect(read('mcp')).toEqual(['MCP servers · Sessions', 'Stateful MCP servers · Supervisor', 'Customize · Plugins, skills and connectors']);
    expect(read('hook')).toEqual(['Hooks in sessions · Sessions']);
    expect(read('theme')).toEqual(['Theme · Appearance']);
    expect(read('shortcut')).toEqual(['Key bindings · Keyboard', 'Shortcut · Voice']);
    expect(search('theme')).toEqual([{ id: 'appearance.theme', name: 'Theme', under: 'Appearance', target: 'appearance.theme' }]);
  });

  // UX wave U7b (O-47): the usage panel is one declared row of Usage, so the search finds it and lands on the section
  it('finds Usage and its panel, "Claude accounts", by the section’s name and the row’s words', () => {
    expect(read('usage')).toEqual(['Direct login · Gateway', 'Usage', 'Claude accounts · Usage']); // Direct login's note names ClaudeUsage
    expect(search('usage').find((r) => r.id === 'usage.accounts')).toEqual({ id: 'usage.accounts', name: 'Claude accounts', under: 'Usage', target: 'usage.accounts' });
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
    expect(ids('MEMORY Budget')).toEqual(['supervisor.memoryBudget']); // its label until the word cut, now a keyword
    expect(ids('memory zebra')).toEqual([]);
    expect(ids('mcp stateful')).toEqual(['supervisor.stateful']);
    expect(search('')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });

  it('lists a section by its name and an Org group by its heading, but never the Org page’s own group headed Org', () => {
    expect(search('people')).toEqual([{ id: 'org:People', name: 'People', under: 'Org', target: 'org:People' }]);
    expect(search('org').filter((r) => r.name === 'Org')).toEqual([{ id: 'section:org', name: 'Org', under: null, target: 'section:org' }]);
    expect(search('Supervisor')[0]).toEqual({ id: 'section:supervisor', name: 'Supervisor', under: null, target: 'section:supervisor' });
    // a group the page does not draw (a Mac not in an org) is no result
    expect(read('people', page(), ['Org'])).toEqual([]);
  });

  it('never matches a row by its group’s name: "keyboard" lists the section and its drawn rows, not every binding', () => {
    expect(read('sessions & engine')).toEqual([]);
    expect(read('keyboard')).toEqual(['Keyboard', 'Key bindings · Keyboard']); // Reset to defaults is drawn once a binding changed
    expect(read('keyboard', page({ 'keyboard.reset': 'default' }))).toEqual(['Keyboard', 'Key bindings · Keyboard', 'Reset to defaults · Keyboard']);
    expect(ids('reset')).toEqual(['keyboard.bindings']); // not drawn: found as the row that reveals it
  });

  it('finds a key binding by its action’s title alone, under Keyboard, while the bindings are drawn', () => {
    expect(search('new chat')).toContainEqual({ id: 'binding:session.new', name: 'New chat', under: 'Keyboard', target: 'binding:session.new' });
    expect(ids('close tab')).toContain('binding:tab.close');
    expect(ids('keyboard close')).not.toContain('binding:tab.close'); // not by its section's name
    expect(search('new chat', page({}, ['keyboard.bindings'])).map((r) => r.id)).not.toContain('binding:session.new');
  });

  it('finds a word in the note a row shows now, and a word at rest beside it; never a word only in another state’s note', () => {
    // the installed binary's note names the shell's PATH; a chosen binary's does not
    expect(search('PATH').filter((r) => r.id === 'engine.binary')).toEqual([{ id: 'engine.binary', name: 'Binary', under: 'Engine', target: 'engine.binary' }]);
    expect(ids('PATH', page({ 'engine.binary': 'chosen' }))).not.toContain('engine.binary');
    expect(ids('released')).toContain('supervisor.limit');
    expect(ids('restored sidebar')).toEqual(['sessions.archive']); // the plain note, once the line
    expect(ids('every hook stateful')).toEqual([]);
    expect(ids('hook launch')).toEqual(['sessions.hooks']); // the line at rest and the note together
    expect(ids('CLAUDE_CODE_SUBAGENT_MODEL')).toEqual(['sessions.subagent']);
  });

  it('finds a row the word cut renamed by its old label, landing on the row as it now reads', () => {
    expect(search('archive sessions inactive')).toEqual([{ id: 'sessions.archive', name: 'Archive after', under: 'Sessions', target: 'sessions.archive' }]);
    expect(ids('relay unreachable at launch')).toEqual(['gateway.policy']);
    expect(ids('per-session direct')).toEqual(['gateway.offerDirect']);
    expect(ids('links that open a new window')).toEqual(['browser.links']);
    expect(ids('when a session finishes')).toEqual(['notifications.when']);
  });

  it('finds Update by its words and lands on the Binary row it is drawn on, and the config home as the Binary row', () => {
    expect(search('claude update terminal')).toEqual([{ id: 'engine.update', name: 'Update', under: 'Engine', target: 'engine.binary' }]);
    expect(search('config home')).toEqual([{ id: 'engine.binary', name: 'Binary', under: 'Engine', target: 'engine.binary' }]);
    expect(ids('transcripts trust')).toEqual(['engine.binary']);
  });

  it('finds a row that is not drawn as the row that reveals it, by its label and keywords only', () => {
    const off = page({ 'supervisor.memoryBudget': 'off' }, ['supervisor.limit', 'supervisor.stateful']);
    expect(search('stateful', off)).toEqual([{ id: 'supervisor.memoryBudget', name: 'Release idle sessions over a memory limit', under: 'Supervisor', target: 'supervisor.memoryBudget' }]);
    expect(ids('memory limit', off)).toEqual(['supervisor.memoryBudget']);
    expect(ids('released', off)).toEqual([]); // the hidden Limit's own note is not on the page
    expect(ids('helper')).toEqual(['voice.language']); // the Helper row, drawn on trouble, as the row whose probe reveals it
    expect(ids('machine daemon')).toEqual(['supervisor.status']);
    expect(ids('RAM', off)).toEqual(['supervisor.memoryBudget']); // one result, though both carry the word
  });

  it('finds a repeating row once by its declared label, landing on its first item, or on the row that reveals it when it has none', () => {
    const populated = page({ 'browser.importedProfile': 'default', 'browser.extension': 'default' });
    expect(search('extensions', populated).filter((r) => r.id === 'browser.extension')).toEqual([{ id: 'browser.extension', name: 'Extensions', under: 'Browser', target: 'browser.extension' }]);
    const imported = (shown: ReadonlyMap<string, string>) => search('imported chrome profile', shown).filter((r) => r.id === 'browser.importedProfile');
    expect(imported(populated)).toEqual([{ id: 'browser.importedProfile', name: 'Imported Chrome profile', under: 'Browser', target: 'browser.importedProfile' }]);
    expect(search('extensions').filter((r) => r.id === 'browser.extension')).toEqual([{ id: 'browser.extension', name: 'Extensions', under: 'Browser', target: 'browser.chromeProfile' }]);
    expect(imported(page())).toEqual([{ id: 'browser.importedProfile', name: 'Imported Chrome profile', under: 'Browser', target: 'browser.chromeProfile' }]);
  });

  it('reads the words around a value in a line, never the place’s name', () => {
    const imported = page({ 'browser.importedProfile': 'default' });
    expect(ids('summary', imported)).not.toContain('browser.importedProfile');
    expect(ids('version', page({ 'engine.binary': 'chosen' }))).not.toContain('engine.binary'); // {version}'s name
    expect(ids('verified against claude code', page({ 'engine.binary': 'chosen' }))).toContain('engine.binary');
  });

  it('stands the results in the page’s order, a section’s own result before its rows', () => {
    const order = ids('engine');
    expect(order.indexOf('browser.search')).toBeGreaterThanOrEqual(0); // "Search engine", in Browser, before Engine
    expect(order.indexOf('browser.search')).toBeLessThan(order.indexOf('sessions.autoFallback'));
    expect(order.indexOf('sessions.autoFallback')).toBeLessThan(order.indexOf('section:engine'));
    expect(order.slice(order.indexOf('section:engine'), order.indexOf('section:engine') + 3)).toEqual(['section:engine', 'engine.binary', 'engine.update']);
    expect(read('mcp').at(-1)).toBe('Customize · Plugins, skills and connectors'); // the index's last link, last
  });
});
