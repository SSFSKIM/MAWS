// The rehearsal's own tests (UX wave U13a, M1): what it prints for invented layout files, and that nothing of a file's
// content, its name or its directory's path reaches its lines, the console, stdout, stderr or the runner's failed
// assertion, whatever goes wrong. Every id, title, path and the sentinel are invented.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageAtStart, storedMain, stripOf, type Strip } from '@shared/ipc/schema/layout';
import { type Converters, type Outcome, rehearsalLines, rehearse, runRehearsal } from './rehearsal';

const SENTINEL = 'zq7SentinelVx';
const L = 'LocalMachineRef0000000';
const OTHER = 'OtherMachineRef0000000';
const session = (address: string, pinned = false) => ({ id: `session:${address}`, kind: 'session', appSessionId: address, pinned });
const agent = (address: string) => ({ id: `agent:${address}:a1`, kind: 'agent', appSessionId: address, agentId: 'a1', pinned: false });
const file = (path: string) => ({ id: `file:${L}:${path}`, kind: 'file', machine: L, path, line: null, appSessionId: null, pinned: false });
const artifacts = { id: 'artifacts', kind: 'artifacts', pinned: false };
type Tab = { id: string; [field: string]: unknown };
const pane = (tabs: Tab[]) => ({ tabs, activeTabId: tabs[0]?.id ?? '' });
const set = (...panes: Tab[][]) => ({ panes: panes.map(pane), focusedPane: 0, splitRatio: 0.5 });
const v3 = (sets: Record<string, unknown>, current = Object.keys(sets)[0]) => ({ version: 3, current, sets, closedTabs: [] });

let directories: string[] = [];
const directoryOf = (files: Record<string, string | null>) => {
  const dir = mkdtempSync(join(tmpdir(), `maws-rehearsal-${SENTINEL}-`));
  directories.push(dir);
  for (const [name, text] of Object.entries(files)) {
    if (text === null) mkdirSync(join(dir, name)); // a name the rehearsal lists and cannot read
    else writeFileSync(join(dir, name), text);
  }
  return dir;
};
afterEach(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
  directories = [];
  vi.restoreAllMocks();
});

// Everything the run sends to the console, stdout and stderr, kept from the terminal, and the runner's failed assertion.
function heard(run: () => void): { output: string; failure: string } {
  const output: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void output.push(args.map(String).join(' ')));
  }
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    }) as never);
  }
  let failure = '';
  try {
    run();
  } catch (error) {
    failure = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  }
  vi.restoreAllMocks();
  return { output: output.join('\n'), failure };
}

describe('the rehearsal', () => {
  it('prints counts and fixed words for each file, in name order, and passes files read whole', () => {
    const dir = directoryOf({
      'b-second.json': JSON.stringify({ 'main.tabs': { version: 2, current: 'invented-project', sets: { 'invented-project': set([session('s1')]) }, closedTabs: [] } }),
      'a-first.json': JSON.stringify({
        'main.tabs': {
          ...v3({
            'smns:invented-alpha': set([session(`${L}/s1`, true), file('/invented/alpha/notes.md')], [session(`${OTHER}/s2`)]),
            none: set([artifacts]),
            'remote:invented-beta': set([session(`${L}/s1`, true), session(`${L}/s3`), agent(`${OTHER}/s2`)]),
          }),
          closedTabs: [session(`${L}/s9`)],
        },
        'panelTools.surfaces': { version: 2, stacks: {}, pinnedTools: [], contexts: { 'smns:invented-alpha': `${L}/s1`, 'remote:invented-beta': `${L}/s3`, none: `${L}/s3` } },
      }),
    });
    const result = rehearse(dir);
    expect(result.files.map((f) => [f.label, f.outcome])).toEqual([['file 1 of 2', 'pass'], ['file 2 of 2', 'pass']]);
    expect(rehearsalLines(result)).toEqual([
      'file 1 of 2  main.tabs v3: 3 sets, 6 tabs, 5 distinct (session 4, agent 1, file 1), 2 pinned, 1 closed, 0 reader warnings; retired 1 open (artifacts 1), 0 closed; front other, expected none',
      '             -> strip: 5 tabs, 2 panes, merged yes, canonical no; missing 0, added 0, twice 0; 2 machine views: held here 3 = 3, held elsewhere 3 = 3; contexts 3 -> 1; active in every pane yes; page none   pass',
      'file 2 of 2  main.tabs v2: 1 set, 1 tab (session 1), 0 pinned, 0 closed, 0 reader warnings; retired 0 open, 0 closed; front other, expected none',
      '             -> strip: 1 tab, 1 pane, merged no, canonical no; missing 0, added 0, twice 0; 1 machine view: held here 1 = 1, held elsewhere 0 = 0; contexts absent; active in every pane yes; page none   pass',
    ]);
    const { output, failure } = heard(() => runRehearsal(dir));
    expect(failure).toBe('');
    expect(output).toContain(rehearsalLines(result).join('\n'));
  });

  it('names a file it cannot use by its label and one word, and lets nothing of it out', () => {
    const unknownKind = v3({ none: set([session(`${L}/s1`), { id: `${SENTINEL}:1`, kind: SENTINEL, pinned: false }]) });
    const dir = directoryOf({
      [`a-${SENTINEL}.json`]: `{ "main.tabs": ${SENTINEL}`,
      'b.json': JSON.stringify({ 'main.tabs': unknownKind }),
      [`c-${SENTINEL}.json`]: null,
      'd.json': JSON.stringify({ 'main.tabs': v3({ none: set([{ ...session(`${L}/s1`), pinned: SENTINEL }]) }) }),
      'e.json': JSON.stringify({ 'main.tabs': unknownKind, 'panelTools.surfaces': { version: 2, stacks: {}, pinnedTools: [], contexts: { [SENTINEL]: '' } } }),
      'f.json': JSON.stringify([SENTINEL]),
      'g.json': JSON.stringify({ [SENTINEL]: SENTINEL }),
      [`h-${SENTINEL}.txt`]: SENTINEL, // not a layout file's name: not read
    });
    const result = rehearse(dir);
    expect(result.files.map((f) => f.outcome)).toEqual(['not-json', 'pass', 'unreadable', 'main-tabs-rejected', 'surfaces-rejected', 'not-a-layout', 'main-tabs-absent']);
    const lines = rehearsalLines(result);
    expect(lines[0]).toBe('file 1 of 7  not-json');
    expect(lines[1]).toContain(', 1 reader warning');
    const { output, failure } = heard(() => runRehearsal(dir));
    expect(failure).not.toBe('');
    for (const text of [lines.join('\n'), output, failure]) {
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(dir);
    }
  });

  it('fails a conversion that loses a tab, adds one, changes an open session, or stores another form, and says only which', () => {
    const dir = directoryOf({ 'one.json': JSON.stringify({ 'main.tabs': v3({ none: set([session(`${L}/s1`), file(`/invented/${SENTINEL}.md`)]), 'smns:x': set([session(`${OTHER}/s2`)]) }, 'none') }) });
    const dropping: typeof stripOf = (stored) => {
      const read = stripOf(stored);
      return { ...read, strip: { ...read.strip, panes: read.strip.panes.map((p) => ({ ...p, tabs: p.tabs.filter((t) => !t.id.includes(SENTINEL)) })) as Strip['panes'] } };
    };
    const adding: typeof stripOf = (stored) => {
      const read = stripOf(stored);
      const [first, ...rest] = read.strip.panes;
      return { ...read, strip: { ...read.strip, panes: [{ ...first, tabs: [...first.tabs, { id: 'diagnostics', kind: 'diagnostics', pinned: false }] }, ...rest] as Strip['panes'] } };
    };
    const moving: typeof storedMain = (strip) => {
      const stored = storedMain(strip);
      const panes = stored.sets.none!.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.kind === 'session' ? { ...t, appSessionId: `${OTHER}/${SENTINEL}` } : t)) }));
      return { ...stored, sets: { none: { ...stored.sets.none!, panes: panes as Strip['panes'] } } } as ReturnType<typeof storedMain>;
    };
    const keyed: typeof storedMain = (strip) => ({ ...storedMain(strip), current: `smns:${SENTINEL}` }) as ReturnType<typeof storedMain>;
    const throwing: typeof stripOf = () => {
      throw new Error(`cannot read ${SENTINEL} at ${dir}`);
    };
    const cases = [
      [{ stripOf: dropping, storedMain, pageAtStart }, 'tab-missing'],
      [{ stripOf: adding, storedMain, pageAtStart }, 'tab-added'],
      [{ stripOf, storedMain: moving, pageAtStart }, 'sessions-differ'],
      [{ stripOf, storedMain: keyed, pageAtStart }, 'not-stored-form'],
      [{ stripOf: throwing, storedMain, pageAtStart }, 'internal'],
    ] as const;
    for (const [converters, word] of cases) {
      const result = rehearse(dir, converters);
      expect(result.files.map((f) => f.outcome)).toEqual([word]);
      expect(rehearsalLines(result)).toEqual([`file 1 of 1  ${word}`]);
      const { output, failure } = heard(() => runRehearsal(dir, converters));
      expect(failure).not.toBe('');
      for (const text of [output, failure]) {
        expect(text).not.toContain(SENTINEL);
        expect(text).not.toContain(dir);
      }
    }
  });

  it('fails a directory it cannot read, or one with no layout file, without naming it', () => {
    const empty = directoryOf({ [`${SENTINEL}.txt`]: SENTINEL });
    const missing = join(empty, `${SENTINEL}-absent`);
    for (const [dir, line] of [[missing, 'directory unreadable'], [empty, 'no layout files']] as const) {
      expect(rehearsalLines(rehearse(dir))).toEqual([line]);
      const { output, failure } = heard(() => runRehearsal(dir));
      expect(failure).not.toBe('');
      for (const text of [output, failure]) {
        expect(text).not.toContain(SENTINEL);
        expect(text).not.toContain(dir);
      }
    }
  });

  // UX wave U7b (M6, decision 4; Interfaces §G, "The rehearsal"): a layout F wrote with tabs of the four retired kinds.
  // They are counted from the raw value; which was in front, and the page it calls for, are the rehearsal's own reading,
  // compared with the page `pageAtStart` answers. A sentinel in a retired tab's fields reaches no output.
  describe('the four retired tab kinds', () => {
    const settings = { id: 'settings', kind: 'settings', section: 'engine', pinned: false, note: SENTINEL };
    const customize = (section: string) => ({ id: 'customize', kind: 'customize', section, pinned: false });
    const projects = { id: 'projects', kind: 'projects', pinned: false };
    // One set under `none` (the stored form's shape), Customize in front, the library in the closed history.
    const fWrote = (front: Tab) => ({
      version: 3,
      current: 'none',
      sets: { none: { panes: [{ tabs: [session(`${L}/s1`), settings, front], activeTabId: front.id }, { tabs: [projects, file('/invented/notes.md')], activeTabId: 'projects' }], focusedPane: 0, splitRatio: 0.5 } },
      closedTabs: [artifacts, { ...artifacts, id: SENTINEL }, session(`${L}/s9`)],
    });
    const library = { version: 1, destination: { kind: 'library' } };

    it('counts them from the raw value, and passes a file whose page is the one its front calls for', () => {
      const dir = directoryOf({
        'a.json': JSON.stringify({ 'main.tabs': fWrote(customize('skills')), destination: library }),
        'b.json': JSON.stringify({ 'main.tabs': fWrote(session(`${L}/s2`)), destination: library }),
        'c.json': JSON.stringify({ 'main.tabs': fWrote(settings), destination: library }),
      });
      const result = rehearse(dir);
      expect(result.files.map((f) => f.outcome)).toEqual(['pass', 'pass', 'pass']);
      expect(rehearsalLines(result)).toEqual([
        'file 1 of 3  main.tabs v3: 1 set, 2 tabs (session 1, file 1), 0 pinned, 1 closed, 0 reader warnings; retired 3 open (settings 1, customize 1, projects 1), 2 closed; front customize, expected customize skills',
        '             -> strip: 2 tabs, 2 panes, merged no, canonical yes; missing 0, added 0, twice 0; 1 machine view: held here 1 = 1, held elsewhere 0 = 0; contexts absent; active in every pane yes; page customize skills   pass',
        'file 2 of 3  main.tabs v3: 1 set, 3 tabs (session 2, file 1), 0 pinned, 1 closed, 0 reader warnings; retired 2 open (settings 1, projects 1), 2 closed; front other, expected library',
        '             -> strip: 3 tabs, 2 panes, merged no, canonical yes; missing 0, added 0, twice 0; 1 machine view: held here 2 = 2, held elsewhere 0 = 0; contexts absent; active in every pane yes; page library   pass',
        'file 3 of 3  main.tabs v3: 1 set, 2 tabs (session 1, file 1), 0 pinned, 1 closed, 0 reader warnings; retired 3 open (settings 2, projects 1), 2 closed; front settings, expected none',
        '             -> strip: 2 tabs, 2 panes, merged no, canonical yes; missing 0, added 0, twice 0; 1 machine view: held here 1 = 1, held elsewhere 0 = 0; contexts absent; active in every pane yes; page none   pass',
      ]);
      const { output, failure } = heard(() => runRehearsal(dir));
      expect(failure).toBe('');
      expect(output).not.toContain(SENTINEL);
    });

    it('fails a page other than the one expected, a retired tab kept and a pane with no tab active, and says only which', () => {
      const dir = directoryOf({ 'one.json': JSON.stringify({ 'main.tabs': fWrote(customize(SENTINEL)) }) });
      const retaining: typeof stripOf = (stored) => {
        const read = stripOf(stored);
        const [first, ...rest] = read.strip.panes;
        return { ...read, strip: { ...read.strip, panes: [{ ...first, tabs: [...first.tabs, { id: 'customize', kind: 'diagnostics', pinned: false } as never] }, ...rest] as Strip['panes'] } } as ReturnType<typeof stripOf>;
      };
      const inactive: typeof stripOf = (stored) => {
        const read = stripOf(stored);
        return { ...read, strip: { ...read.strip, panes: read.strip.panes.map((p) => ({ ...p, activeTabId: SENTINEL })) as Strip['panes'] } };
      };
      const cases: [Converters, Outcome][] = [
        [{ stripOf, storedMain, pageAtStart: () => null }, 'destination-mismatch'],
        [{ stripOf, storedMain, pageAtStart: () => ({ kind: 'projects' }) }, 'destination-mismatch'],
        [{ stripOf: retaining, storedMain, pageAtStart }, 'retired-kept'],
        [{ stripOf: inactive, storedMain, pageAtStart }, 'no-active-tab'],
      ];
      for (const [converters, word] of cases) {
        const result = rehearse(dir, converters);
        expect(result.files.map((f) => f.outcome)).toEqual([word]);
        expect(rehearsalLines(result)).toEqual([`file 1 of 1  ${word}`]);
        const { output, failure } = heard(() => runRehearsal(dir, converters));
        expect(failure).not.toBe('');
        for (const text of [output, failure]) {
          expect(text).not.toContain(SENTINEL);
          expect(text).not.toContain(dir);
        }
      }
      // with the real converters the same file passes: an unknown section reads as Plugins on both sides
      const passed = rehearse(dir);
      expect(passed.files.map((f) => f.outcome)).toEqual(['pass']);
      expect(rehearsalLines(passed).join('\n')).toContain('front customize, expected customize plugins');
      expect(rehearsalLines(passed).join('\n')).not.toContain(SENTINEL);
    });

    it('compares the whole page, so a converter that changes only its view fails the file', () => {
      const discover = { version: 1, destination: { kind: 'customize', view: 'discover', show: 'connectors' } };
      const dir = directoryOf({
        'a.json': JSON.stringify({ 'main.tabs': fWrote(customize('skills')) }),
        'b.json': JSON.stringify({ 'main.tabs': fWrote(session(`${L}/s2`)), destination: discover }),
      });
      const real = rehearse(dir);
      expect(real.files.map((f) => f.outcome)).toEqual(['pass', 'pass']);
      expect(rehearsalLines(real).filter((line) => line.includes('expected customize'))).toHaveLength(2);
      // a retired Customize tab answered at Discover, and a stored Discover page answered at Mine; the show is right in both
      const atView = (view: 'mine' | 'discover'): typeof pageAtStart => (input) => {
        const page = pageAtStart(input);
        return page?.kind === 'customize' ? { ...page, view } : page;
      };
      expect(rehearse(dir, { stripOf, storedMain, pageAtStart: atView('discover') }).files.map((f) => f.outcome)).toEqual(['destination-mismatch', 'pass']);
      expect(rehearse(dir, { stripOf, storedMain, pageAtStart: atView('mine') }).files.map((f) => f.outcome)).toEqual(['pass', 'destination-mismatch']);
    });
  });
});
