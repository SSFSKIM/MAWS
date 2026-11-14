// U11a M10 (l8-settings-06, A7; the execution document's Interfaces §G, "Search"): "Search settings", a pure function
// over the row table, the state each drawn row shows now, the keyboard's bindings and the Org page's group headings.
// A result never names text the page will not show in its present state: a drawn row is matched by its label, its
// keywords, its section's name and the line and More of the state it shows; a row not drawn counts, by its label and
// keywords, for the drawn row that reveals it; a repeating row is one result by its declared label. A row is never
// matched by its group's name, and a binding only by its action's title. Every word of the query must be found, case
// ignored, and the results stand in the page's order, a section's own result before its rows, the Customize link last.
import { INDEX, SECTIONS } from './copy';
import type { SettingsRow } from './rows';
import { SECTION_TABLE } from './SettingsView'; // read when a search runs, never as this module loads (SettingsView imports the view of this search)

export interface SettingsResult {
  id: string;
  name: string;
  under: string;
  target: string; // a row's id (data-settings-row), `section:<section>`, `binding:<action>`, `org:<heading>`, or `customize`
  openMore: boolean;
}

type Input = { rows: readonly SettingsRow[]; shown: ReadonlyMap<string, string>; bindings: readonly { id: string; title: string }[]; orgGroups: readonly string[] };

// The row whose table holds the key bindings: they are results while it is drawn, and stand after it.
const BINDINGS_ROW = 'keyboard.bindings';
const CUSTOMIZE_KEYWORDS = ['plugins', 'skills', 'connectors', 'marketplace', 'mcp'];
// A {name} in a state's words is a value the drawn row fills in: the search reads the words around it, never the place.
const PLACE = /\{\w+\}/g;

const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter((word) => word !== '');
const text = (parts: readonly (string | undefined)[]) => parts.filter((part) => part !== undefined).join(' ').replace(PLACE, ' ').toLowerCase();
const findsAll = (words: readonly string[], haystack: string) => words.every((word) => haystack.includes(word));

export function searchSettings(query: string, { rows, shown, bindings, orgGroups }: Input): SettingsResult[] {
  const words = wordsOf(query);
  if (words.length === 0) return [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  // where a row not drawn lands: the nearest drawn row that reveals it, or nowhere
  const drawnRevealer = (row: SettingsRow): string | null => {
    for (let at = row.revealedBy; at !== undefined; at = byId.get(at)?.revealedBy) if (shown.has(at)) return at;
    return null;
  };
  // the label and keywords of each row not drawn, counted for the drawn row that reveals it
  const borrowed = new Map<string, string[]>();
  for (const row of rows) {
    if (shown.has(row.id) || row.repeats) continue;
    const at = drawnRevealer(row);
    if (at !== null) borrowed.set(at, [...(borrowed.get(at) ?? []), row.label, ...(row.keywords ?? [])]);
  }

  const results: SettingsResult[] = [];
  for (const { section } of SECTION_TABLE) {
    const sectionName = SECTIONS[section];
    if (findsAll(words, text([sectionName]))) results.push({ id: `section:${section}`, name: sectionName, under: INDEX.under.section, target: `section:${section}`, openMore: false });
    for (const row of rows) {
      if (row.section !== section) continue;
      const result = { id: row.id, name: row.label, under: sectionName, target: row.id, openMore: false };
      const state = shown.get(row.id);
      if (state !== undefined) {
        const now = row.states[state] ?? {};
        const onLine = text([row.label, ...(row.keywords ?? []), sectionName, now.line, ...(borrowed.get(row.id) ?? [])]);
        if (findsAll(words, onLine)) results.push(result);
        else if (now.more !== undefined && findsAll(words, `${onLine} ${text([now.more])}`)) results.push({ ...result, openMore: true });
      } else if (row.repeats) {
        const at = drawnRevealer(row);
        if (at !== null && findsAll(words, text([row.label, ...(row.keywords ?? [])]))) results.push({ ...result, target: at });
      }
      if (row.id === BINDINGS_ROW && shown.has(row.id))
        for (const binding of bindings)
          if (findsAll(words, text([binding.title]))) results.push({ id: `binding:${binding.id}`, name: binding.title, under: SECTIONS.keyboard, target: `binding:${binding.id}`, openMore: false });
    }
    // the Org page's groups; its own group headed Org is the section's result
    if (section === 'org')
      for (const heading of orgGroups)
        if (heading !== SECTIONS.org && findsAll(words, text([heading]))) results.push({ id: `org:${heading}`, name: heading, under: SECTIONS.org, target: `org:${heading}`, openMore: false });
  }
  if (findsAll(words, text([INDEX.customize, ...CUSTOMIZE_KEYWORDS]))) results.push({ id: 'customize', name: INDEX.customize, under: INDEX.under.customize, target: 'customize', openMore: false });
  return results;
}
