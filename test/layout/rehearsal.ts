// The rehearsal (UX wave U13a; section, "The rehearsal"; root UC-14; the U13a plan's M1): before a wave build first runs
// on one of the owner's machines, the one strip's reader runs over a copy of that machine's `layout.json`. Tabs in must
// equal tabs out, and the sessions main counts as open must be the same before and after.
//
// Its lines go into a public pull request (root UC-11), so nothing of a file's content leaves `rehearse`: it returns,
// per file, a label it makes (`file 1 of n`, in name order), numbers, booleans, and one word of `OUTCOMES`. Every read,
// parse and conversion runs under a catch that keeps the word and drops the error (a file-system error carries the
// path, `JSON.parse`'s message can quote its input, a schema issue can quote a value), and the console is held for the
// length of the run, what the reader prints (`dropUnknownTabs` names the kinds it drops) counted as reader warnings and
// never printed. A file that does not pass gets its label and its word and nothing else.
//
// How a file is read (the U13a plan's Decision Log, M1): `main.tabs` and `panelTools.surfaces` with the schemas the app
// reads them with, lifting what predates O6 with `REHEARSAL_LOCAL`, a ref no machine has. Version 3 holds addresses, so
// the local machine changes nothing of it; versions 1 and 2 hold bare ids, which every reader lifts with whatever local
// machine it is given. Main's two readers are then run once per machine view: each machine a session or agent tab's
// address names (for a value from before O6, that is `REHEARSAL_LOCAL`), as the local machine, over the value as stored
// and over what `storedMain` makes of its strip. The printed counts sum the views. `contexts n -> m` counts the keys of
// `panelTools.surfaces.contexts` as stored and after the section's step 4: the entry of the set that was showing (for
// version 1, the `none` entry), kept under `none`, and nothing else.
//
// UX wave U7b (its execution document, M6, decision 4, and Interfaces §G, "The rehearsal"): the four retired tab kinds
// (Settings, the library, Projects and Customize) are already out of what the reader parsed, so they are counted from the
// raw value: open and in the closed history, by kind. Which kind was in front, and the page that front calls for, are
// read by this file's own reader of the raw value, which shares no code with `retiredFront` or `pageAtStart`; the page
// `pageAtStart` answers is compared with it whole (kind, view and show), and only then put into words. A retired tab that survives the read, a pane with tabs and none active, and
// a page other than the one expected each fail the file.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';
import {
  type Destination, LayoutMainSchema, type LayoutMain, type LayoutMainV1, NO_PROJECT, pageAtStart, type PaneState, StoredDestinationSchema, storedMain,
  storedMainSchema, storedPanelSurfacesSchema, stripOf, type TabRef, TabRefSchema,
} from '@shared/ipc/schema/layout';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { remoteSessionsInTabs } from '../../src/main/lane-b/remote-interest';
import { sessionsInTabs } from '../../src/main/layout/open-session-tabs';

export const OUTCOMES = [
  'pass', 'unreadable', 'not-json', 'not-a-layout', 'main-tabs-absent', 'main-tabs-rejected', 'surfaces-rejected', 'tab-missing', 'tab-added', 'tab-twice',
  'sessions-differ', 'not-stored-form', 'retired-kept', 'no-active-tab', 'destination-mismatch', 'internal',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The converters under rehearsal; a test hands in a broken one. */
export interface Converters {
  stripOf: typeof stripOf;
  storedMain: typeof storedMain;
  pageAtStart: typeof pageAtStart; // UX wave U7b
}

const KINDS: readonly TabRef['kind'][] = TabRefSchema.options.map((option) => option.shape.kind.value);
// UX wave U7b: the four retired kinds, each by the id its one tab had, and the page a tab of it in front calls for.
const RETIRED = ['settings', 'customize', 'projects', 'artifacts'] as const;
type Retired = (typeof RETIRED)[number];
type Front = Retired | 'other' | 'none';
/** A page as the rehearsal prints it: `customize <show>`, `projects`, `library`, or `none`. */
type PageWord = string;

/** What a file that passed is reported with: counts and booleans, nothing read from it. */
export interface FileFacts {
  version: 1 | 2 | 3;
  sets: number;
  tabs: number; // tab entries over every set's panes
  distinct: number; // distinct tab ids among them
  kinds: [TabRef['kind'], number][]; // entries by kind, in `TabRefSchema`'s order, the kinds held only
  pinned: number;
  closed: number;
  warnings: number; // what the reader printed while it read
  strip: { tabs: number; panes: number; merged: boolean; canonical: boolean; missing: number; added: number; twice: number };
  views: number;
  here: { before: number; after: number };
  elsewhere: { before: number; after: number };
  contexts: { before: number; after: number } | null; // null: no `panelTools.surfaces`
  retired: { open: [Retired, number][]; closed: number }; // UX wave U7b: from the raw value, the kinds held only
  front: Front;
  expected: PageWord;
  page: PageWord;
}

export interface FileResult {
  label: string;
  outcome: Outcome;
  facts: FileFacts | null; // a file that passed only
}

export interface Rehearsal {
  directory: 'read' | 'unreadable';
  files: FileResult[];
}

/** The ref the rehearsal lifts ids from before O6 with: matches `MachineRefSchema`, and is no machine's. */
export const REHEARSAL_LOCAL = 'rehearsal-local-machine' as MachineRef;

class Refused extends Error {
  constructor(readonly outcome: Outcome) {
    super(outcome);
  }
}
// Runs a step; any throw becomes the step's word, its error dropped.
function step<T>(outcome: Outcome, run: () => T): T {
  try {
    return run();
  } catch {
    throw new Refused(outcome);
  }
}

const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
// Holds the console for `run`, counting what is printed to it instead.
function holdingConsole<T>(run: (printed: () => number) => T): T {
  const saved = CONSOLE.map((method) => console[method]);
  let count = 0;
  for (const method of CONSOLE) console[method] = () => void (count += 1);
  try {
    return run(() => count);
  } finally {
    CONSOLE.forEach((method, i) => {
      console[method] = saved[i];
    });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const panesOf = (stored: LayoutMain | LayoutMainV1): PaneState[] =>
  stored.version === 1 ? stored.panes : Object.values(stored.sets).flatMap((set) => set?.panes ?? []);
const sizeOf = (held: Map<MachineRef, Set<string>>) => [...held.values()].reduce((sum, ids) => sum + ids.size, 0);

// ---- UX wave U7b: the retired kinds, read from the raw value by this file alone -------------------------------------
const rawTabs = (value: unknown): unknown[] => (isRecord(value) && Array.isArray(value.tabs) ? value.tabs : []);
const rawLayouts = (raw: Record<string, unknown>): unknown[] => (isRecord(raw.sets) ? Object.values(raw.sets) : [raw]);
const rawPanes = (layout: unknown): unknown[] => (isRecord(layout) && Array.isArray(layout.panes) ? layout.panes : []);
const kindOf = (tab: unknown): unknown => (isRecord(tab) ? tab.kind : undefined);
const isRetired = (kind: unknown): kind is Retired => (RETIRED as readonly unknown[]).includes(kind);
// The tab in front: the showing set's focused pane's active tab, version 1's value being its own set; undefined for none.
function frontTab(raw: Record<string, unknown>): unknown {
  const showing = isRecord(raw.sets) ? (typeof raw.current === 'string' && Object.hasOwn(raw.sets, raw.current) ? raw.sets[raw.current] : undefined) : raw;
  if (!isRecord(showing)) return undefined;
  const focused = rawPanes(showing)[typeof showing.focusedPane === 'number' ? showing.focusedPane : 0];
  return isRecord(focused) ? rawTabs(focused).find((tab) => isRecord(tab) && tab.id === focused.activeTabId) : undefined;
}
function frontOf(tab: unknown): Front {
  if (tab === undefined) return 'none';
  const kind = kindOf(tab);
  return isRetired(kind) ? kind : 'other';
}
const wordOf = (page: Destination | null): PageWord => (page === null ? 'none' : page.kind === 'customize' ? `customize ${page.show}` : page.kind);
// The page a front calls for: a Customize tab's, at Mine and its section; Projects' and the library's; none for Settings;
// for any other front, the file's own page when `current` and its only set are `none`, else none.
function expectedOf(raw: Record<string, unknown>, layout: Record<string, unknown>, tab: unknown): Destination | null {
  const front = frontOf(tab);
  if (front === 'settings') return null;
  if (front === 'projects') return { kind: 'projects' };
  if (front === 'artifacts') return { kind: 'library' };
  if (front === 'customize') {
    const section = isRecord(tab) ? tab.section : undefined;
    return { kind: 'customize', view: 'mine', show: section === 'skills' ? 'skills' : section === 'mcp' ? 'connectors' : 'plugins' };
  }
  const own = isRecord(raw.sets) && raw.current === NO_PROJECT && Object.keys(raw.sets).length === 1 && Object.hasOwn(raw.sets, NO_PROJECT);
  const stored = StoredDestinationSchema.safeParse(layout.destination);
  return own && stored.success ? stored.data.destination : null;
}

function rehearseFile(path: string, converters: Converters, printed: () => number): FileFacts {
  const text = step('unreadable', () => readFileSync(path, 'utf8'));
  const layout: unknown = step('not-json', () => JSON.parse(text));
  if (!isRecord(layout)) throw new Refused('not-a-layout');
  if (!Object.hasOwn(layout, 'main.tabs')) throw new Refused('main-tabs-absent');
  const raw = layout['main.tabs'];
  // UX wave U7b: what the retired kinds were in the raw value, before the reader drops them
  const retiredOpen = new Map<Retired, number>();
  let retiredClosed = 0;
  let front: Front = 'none';
  let expected: Destination | null = null;
  if (isRecord(raw)) {
    for (const tab of rawLayouts(raw).flatMap(rawPanes).flatMap(rawTabs)) {
      const kind = kindOf(tab);
      if (isRetired(kind)) retiredOpen.set(kind, (retiredOpen.get(kind) ?? 0) + 1);
    }
    retiredClosed = (Array.isArray(raw.closedTabs) ? raw.closedTabs : []).filter((tab) => isRetired(kindOf(tab))).length;
    const tab = frontTab(raw);
    front = frontOf(tab);
    expected = expectedOf(raw, layout, tab);
  }
  const before = printed();
  const read = storedMainSchema(REHEARSAL_LOCAL).safeParse(raw);
  const warnings = printed() - before;
  if (!read.success) throw new Refused('main-tabs-rejected');
  const stored = read.data;
  let contexts: Record<string, unknown> | null = null;
  if (Object.hasOwn(layout, 'panelTools.surfaces')) {
    const surfaces = storedPanelSurfacesSchema(REHEARSAL_LOCAL).safeParse(layout['panelTools.surfaces']);
    if (!surfaces.success) throw new Refused('surfaces-rejected');
    contexts = surfaces.data.contexts;
  }

  const tabsIn = panesOf(stored).flatMap((pane) => pane.tabs);
  const idsIn = new Set(tabsIn.map((tab) => tab.id));
  const { strip, merged, canonical } = converters.stripOf(stored);
  const idsOut = strip.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id));
  const distinctOut = new Set(idsOut);
  const missing = [...idsIn].filter((id) => !distinctOut.has(id)).length;
  const added = [...distinctOut].filter((id) => !idsIn.has(id)).length;
  const twice = idsOut.length - distinctOut.size;
  // UX wave U7b: no tab of a retired kind is in the strip, and every pane with tabs has one active
  if (idsOut.some((id) => (RETIRED as readonly string[]).includes(id))) throw new Refused('retired-kept');
  if (strip.panes.some((pane) => pane.tabs.length > 0 && !pane.tabs.some((tab) => tab.id === pane.activeTabId))) throw new Refused('no-active-tab');
  if (missing > 0) throw new Refused('tab-missing');
  if (added > 0) throw new Refused('tab-added');
  if (twice > 0) throw new Refused('tab-twice');

  const written = converters.storedMain(strip);
  const views = new Set<MachineRef>();
  for (const tab of tabsIn) if ((tab.kind === 'session' || tab.kind === 'agent') && isAddress(tab.appSessionId)) views.add(machineOf(tab.appSessionId));
  const here = { before: 0, after: 0 };
  const elsewhere = { before: 0, after: 0 };
  for (const local of views) {
    const [hereBefore, hereAfter] = [sessionsInTabs(raw, local), sessionsInTabs(written, local)];
    const [elsewhereBefore, elsewhereAfter] = [remoteSessionsInTabs(raw, local), remoteSessionsInTabs(written, local)];
    if (!isDeepStrictEqual(hereBefore, hereAfter) || !isDeepStrictEqual(elsewhereBefore, elsewhereAfter)) throw new Refused('sessions-differ');
    here.before += hereBefore.size;
    here.after += hereAfter.size;
    elsewhere.before += sizeOf(elsewhereBefore);
    elsewhere.after += sizeOf(elsewhereAfter);
  }

  // The stored form: F's schema takes it whole and unchanged, and it reads back as the same strip, canonical, unmerged.
  const fRead = LayoutMainSchema.safeParse(written);
  const readBack = converters.stripOf(written);
  if (!fRead.success || !isDeepStrictEqual(fRead.data, written) || !readBack.canonical || readBack.merged || !isDeepStrictEqual(readBack.strip, strip)) {
    throw new Refused('not-stored-form');
  }

  // UX wave U7b: the page hydration opens, against the page this file's own reader expects
  const storedPage = StoredDestinationSchema.safeParse(layout.destination);
  const page = converters.pageAtStart({ rawMain: raw, canonical, stored: storedPage.success ? storedPage.data.destination : null });
  if (!isDeepStrictEqual(page, expected)) throw new Refused('destination-mismatch');

  const showing = stored.version === 1 ? NO_PROJECT : stored.current;
  return {
    version: stored.version === 1 ? 1 : isRecord(raw) && raw.version === 2 ? 2 : 3,
    sets: stored.version === 1 ? 1 : Object.keys(stored.sets).length,
    tabs: tabsIn.length,
    distinct: idsIn.size,
    kinds: KINDS.map((kind): [TabRef['kind'], number] => [kind, tabsIn.filter((tab) => tab.kind === kind).length]).filter(([, n]) => n > 0),
    pinned: tabsIn.filter((tab) => tab.pinned).length,
    closed: stored.closedTabs.length,
    warnings,
    strip: { tabs: idsOut.length, panes: strip.panes.length, merged, canonical, missing, added, twice },
    views: views.size,
    here,
    elsewhere,
    contexts: contexts === null ? null : { before: Object.keys(contexts).length, after: Object.hasOwn(contexts, showing) ? 1 : 0 },
    retired: { open: RETIRED.flatMap((kind): [Retired, number][] => (retiredOpen.has(kind) ? [[kind, retiredOpen.get(kind)!]] : [])), closed: retiredClosed },
    front,
    expected: wordOf(expected),
    page: wordOf(page),
  };
}

/** Runs the rehearsal over every `*.json` file of `directory`, in name order. Nothing of a file's content leaves it. */
export function rehearse(directory: string, converters: Converters = { stripOf, storedMain, pageAtStart }): Rehearsal {
  return holdingConsole((printed) => {
    let names: string[];
    try {
      names = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
    } catch {
      return { directory: 'unreadable', files: [] };
    }
    const files = names.map((name, i): FileResult => {
      const label = `file ${i + 1} of ${names.length}`;
      try {
        return { label, outcome: 'pass', facts: rehearseFile(join(directory, name), converters, printed) };
      } catch (error) {
        return { label, outcome: error instanceof Refused ? error.outcome : 'internal', facts: null };
      }
    });
    return { directory: 'read', files };
  });
}

const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const yesNo = (value: boolean) => (value ? 'yes' : 'no');

/** The rehearsal's lines: generated labels, counts and fixed words. */
export function rehearsalLines(rehearsal: Rehearsal): string[] {
  if (rehearsal.directory === 'unreadable') return ['directory unreadable'];
  if (rehearsal.files.length === 0) return ['no layout files'];
  return rehearsal.files.flatMap(({ label, outcome, facts }) => {
    if (facts === null) return [`${label}  ${outcome}`];
    const { strip, here, elsewhere, contexts } = facts;
    const distinct = facts.distinct === facts.tabs ? '' : `, ${facts.distinct} distinct`;
    const kinds = facts.kinds.map(([kind, n]) => `${kind} ${n}`).join(', ');
    const retiredKinds = facts.retired.open.map(([kind, n]) => `${kind} ${n}`).join(', ');
    const retiredOpen = facts.retired.open.reduce((sum, [, n]) => sum + n, 0);
    const retired = `retired ${retiredOpen} open${retiredKinds === '' ? '' : ` (${retiredKinds})`}, ${facts.retired.closed} closed; front ${facts.front}, expected ${facts.expected}`;
    const stored = `main.tabs v${facts.version}: ${counted(facts.sets, 'set')}, ${counted(facts.tabs, 'tab')}${distinct}${kinds === '' ? '' : ` (${kinds})`}, ${facts.pinned} pinned, ${facts.closed} closed, ${counted(facts.warnings, 'reader warning')}; ${retired}`;
    const read = [
      `-> strip: ${counted(strip.tabs, 'tab')}, ${counted(strip.panes, 'pane')}, merged ${yesNo(strip.merged)}, canonical ${yesNo(strip.canonical)}`,
      `missing ${strip.missing}, added ${strip.added}, twice ${strip.twice}`,
      `${counted(facts.views, 'machine view')}: held here ${here.before} = ${here.after}, held elsewhere ${elsewhere.before} = ${elsewhere.after}`,
      contexts === null ? 'contexts absent' : `contexts ${contexts.before} -> ${contexts.after}`,
      `active in every pane yes; page ${facts.page}`,
    ].join('; ');
    return [`${label}  ${stored}`, `${' '.repeat(label.length + 2)}${read}   ${outcome}`];
  });
}

/** How many runs of the rehearsal did not pass: each file that did not, and a directory unread or with no layout file. */
export function notPassed(rehearsal: Rehearsal): number {
  if (rehearsal.directory === 'unreadable' || rehearsal.files.length === 0) return 1;
  return rehearsal.files.filter((file) => file.outcome !== 'pass').length;
}

/** The runner's whole act: print the lines, and assert that every file passed, on a count alone. */
export function runRehearsal(directory: string, converters?: Converters): void {
  const rehearsal = rehearse(directory, converters);
  console.log(rehearsalLines(rehearsal).join('\n'));
  expect(notPassed(rehearsal), 'layout files that did not pass the rehearsal').toBe(0);
}
