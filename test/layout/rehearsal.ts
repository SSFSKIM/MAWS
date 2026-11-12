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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';
import {
  LayoutMainSchema, type LayoutMain, type LayoutMainV1, NO_PROJECT, type PaneState, storedMain, storedMainSchema, storedPanelSurfacesSchema, stripOf,
  type TabRef, TabRefSchema,
} from '@shared/ipc/schema/layout';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { remoteSessionsInTabs } from '../../src/main/lane-b/remote-interest';
import { sessionsInTabs } from '../../src/main/layout/open-session-tabs';

export const OUTCOMES = [
  'pass', 'unreadable', 'not-json', 'not-a-layout', 'main-tabs-absent', 'main-tabs-rejected', 'surfaces-rejected', 'tab-missing', 'tab-twice',
  'sessions-differ', 'not-stored-form', 'internal',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The two converters under rehearsal; a test hands in a broken one. */
export interface Converters {
  stripOf: typeof stripOf;
  storedMain: typeof storedMain;
}

const KINDS: readonly TabRef['kind'][] = TabRefSchema.options.map((option) => option.shape.kind.value);

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
  strip: { tabs: number; panes: number; merged: boolean; canonical: boolean; missing: number; twice: number };
  views: number;
  here: { before: number; after: number };
  elsewhere: { before: number; after: number };
  contexts: { before: number; after: number } | null; // null: no `panelTools.surfaces`
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

function rehearseFile(path: string, converters: Converters, printed: () => number): FileFacts {
  const text = step('unreadable', () => readFileSync(path, 'utf8'));
  const layout: unknown = step('not-json', () => JSON.parse(text));
  if (!isRecord(layout)) throw new Refused('not-a-layout');
  if (!('main.tabs' in layout)) throw new Refused('main-tabs-absent');
  const raw = layout['main.tabs'];
  const before = printed();
  const read = storedMainSchema(REHEARSAL_LOCAL).safeParse(raw);
  const warnings = printed() - before;
  if (!read.success) throw new Refused('main-tabs-rejected');
  const stored = read.data;
  let contexts: Record<string, unknown> | null = null;
  if ('panelTools.surfaces' in layout) {
    const surfaces = storedPanelSurfacesSchema(REHEARSAL_LOCAL).safeParse(layout['panelTools.surfaces']);
    if (!surfaces.success) throw new Refused('surfaces-rejected');
    contexts = surfaces.data.contexts;
  }

  const tabsIn = panesOf(stored).flatMap((pane) => pane.tabs);
  const idsIn = new Set(tabsIn.map((tab) => tab.id));
  const { strip, merged, canonical } = converters.stripOf(stored);
  const idsOut = strip.panes.flatMap((pane) => pane.tabs.map((tab) => tab.id));
  const missing = [...idsIn].filter((id) => !idsOut.includes(id)).length;
  const twice = idsOut.length - new Set(idsOut).size;
  if (missing > 0) throw new Refused('tab-missing');
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
    strip: { tabs: idsOut.length, panes: strip.panes.length, merged, canonical, missing, twice },
    views: views.size,
    here,
    elsewhere,
    contexts: contexts === null ? null : { before: Object.keys(contexts).length, after: showing in contexts ? 1 : 0 },
  };
}

/** Runs the rehearsal over every `*.json` file of `directory`, in name order. Nothing of a file's content leaves it. */
export function rehearse(directory: string, converters: Converters = { stripOf, storedMain }): Rehearsal {
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
    const stored = `main.tabs v${facts.version}: ${counted(facts.sets, 'set')}, ${counted(facts.tabs, 'tab')}${distinct}${kinds === '' ? '' : ` (${kinds})`}, ${facts.pinned} pinned, ${facts.closed} closed, ${counted(facts.warnings, 'reader warning')}`;
    const read = [
      `-> strip: ${counted(strip.tabs, 'tab')}, ${counted(strip.panes, 'pane')}, merged ${yesNo(strip.merged)}, canonical ${yesNo(strip.canonical)}`,
      `missing ${strip.missing}, twice ${strip.twice}`,
      `${counted(facts.views, 'machine view')}: held here ${here.before} = ${here.after}, held elsewhere ${elsewhere.before} = ${elsewhere.after}`,
      contexts === null ? 'contexts absent' : `contexts ${contexts.before} -> ${contexts.after}`,
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
