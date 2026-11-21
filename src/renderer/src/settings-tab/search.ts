// U11a M10 (l8-settings-06, A7; the execution document's Interfaces §G, "Search"): "Search settings", a pure function
// over the row table, the state each drawn row shows now, the keyboard's bindings and the Org page's group headings.
// A result never names text the page will not show in its present state: a drawn row is matched by its label, its
// keywords, its section's name and the words of the state it shows (the word cut: its line and its note, which the
// row shows when the landing gives it the keyboard); a row not drawn counts, by its label and
// keywords, for the drawn row that reveals it; a repeating row is one result by its declared label. A row is never
// matched by its group's name, and a binding only by its action's title. Every word of the query must be found, case
// ignored, and the results stand in the page's order, a section's own result before its rows, the Customize link last.
import { INDEX, SECTIONS } from './copy';
import type { SettingsRow } from './rows';
import { SECTION_TABLE } from './SettingsView'; // read when a search runs, never as this module loads (SettingsView imports the view of this search)

export interface SettingsResult {
  id: string;
  name: string;
  under: string | null; // a whole section's result has nothing under its name (the word cut, G9)
  target: string; // a row's id (data-settings-row), `section:<section>`, `binding:<action>`, `org:<heading>`, or `customize`
  // a row not drawn whose words found this one (its label or keywords, counted for the row that reveals it): inside the
  // target, the word that shows that row's words in its tooltip (`data-settings-shows`), if one does, takes the landing
  via?: string;
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
  const borrowed = new Map<string, { id: string; words: string[] }[]>();
  for (const row of rows) {
    if (shown.has(row.id) || row.repeats) continue;
    const at = drawnRevealer(row);
    if (at !== null) borrowed.set(at, [...(borrowed.get(at) ?? []), { id: row.id, words: [row.label, ...(row.keywords ?? [])] }]);
  }

  const results: SettingsResult[] = [];
  for (const { section } of SECTION_TABLE) {
    const sectionName = SECTIONS[section];
    if (findsAll(words, text([sectionName]))) results.push({ id: `section:${section}`, name: sectionName, under: null, target: `section:${section}` });
    for (const row of rows) {
      if (row.section !== section) continue;
      const result = { id: row.id, name: row.label, under: sectionName, target: row.landsOn ?? row.id };
      const state = shown.get(row.id);
      if (state !== undefined) {
        const now = row.states[state] ?? {};
        const own = [row.label, ...(row.keywords ?? []), sectionName, now.line, now.note];
        const lent = borrowed.get(row.id) ?? [];
        if (findsAll(words, text([...own, ...lent.flatMap((b) => b.words)]))) {
          // found by one hidden row's words where its own fall short: that row is the one the landing looks for
          const via = findsAll(words, text(own)) ? undefined : lent.find((b) => findsAll(words, text([...own, ...b.words])))?.id;
          results.push(via === undefined ? result : { ...result, via });
        }
      } else if (row.repeats) {
        const at = drawnRevealer(row);
        if (at !== null && findsAll(words, text([row.label, ...(row.keywords ?? [])]))) results.push({ ...result, target: at });
      }
      if (row.id === BINDINGS_ROW && shown.has(row.id))
        for (const binding of bindings)
          if (findsAll(words, text([binding.title]))) results.push({ id: `binding:${binding.id}`, name: binding.title, under: SECTIONS.keyboard, target: `binding:${binding.id}` });
    }
    // the Org page's groups; its own group headed Org is the section's result
    if (section === 'org')
      for (const heading of orgGroups)
        if (heading !== SECTIONS.org && findsAll(words, text([heading]))) results.push({ id: `org:${heading}`, name: heading, under: SECTIONS.org, target: `org:${heading}` });
  }
  if (findsAll(words, text([INDEX.customize, ...CUSTOMIZE_KEYWORDS]))) results.push({ id: 'customize', name: INDEX.customize, under: INDEX.under.customize, target: 'customize' });
  return results;
}
