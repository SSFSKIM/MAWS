// The rehearsal's own tests (UX wave U13a, M1): what it prints for invented layout files, and that nothing of a file's
// content, its name or its directory's path reaches its lines, the console, stdout, stderr or the runner's failed
// assertion, whatever goes wrong. Every id, title, path and the sentinel are invented.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storedMain, stripOf, type Strip } from '@shared/ipc/schema/layout';
import { rehearsalLines, rehearse, runRehearsal } from './rehearsal';

const SENTINEL = 'zq7SentinelVx';
const L = 'LocalMachineRef0000000';
const OTHER = 'OtherMachineRef0000000';
const session = (address: string, pinned = false) => ({ id: `session:${address}`, kind: 'session', appSessionId: address, pinned });
const agent = (address: string) => ({ id: `agent:${address}:a1`, kind: 'agent', appSessionId: address, agentId: 'a1', pinned: false });
const file = (path: string) => ({ id: `file:${L}:${path}`, kind: 'file', machine: L, path, line: null, appSessionId: null, pinned: false });
const artifacts = { id: 'artifacts', kind: 'artifacts', pinned: false };
const pane = (tabs: { id: string }[]) => ({ tabs, activeTabId: tabs[0]?.id ?? '' });
const set = (...panes: { id: string }[][]) => ({ panes: panes.map(pane), focusedPane: 0, splitRatio: 0.5 });
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
      'file 1 of 2  main.tabs v3: 3 sets, 7 tabs, 6 distinct (session 4, agent 1, file 1, artifacts 1), 2 pinned, 1 closed, 0 reader warnings',
      '             -> strip: 6 tabs, 2 panes, merged yes, canonical no; missing 0, twice 0; 2 machine views: held here 3 = 3, held elsewhere 3 = 3; contexts 3 -> 1   pass',
      'file 2 of 2  main.tabs v2: 1 set, 1 tab (session 1), 0 pinned, 0 closed, 0 reader warnings',
      '             -> strip: 1 tab, 1 pane, merged no, canonical no; missing 0, twice 0; 1 machine view: held here 1 = 1, held elsewhere 0 = 0; contexts absent   pass',
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

  it('fails a conversion that loses a tab, changes an open session, or stores another form, and says only which', () => {
    const dir = directoryOf({ 'one.json': JSON.stringify({ 'main.tabs': v3({ none: set([session(`${L}/s1`), file(`/invented/${SENTINEL}.md`)]), 'smns:x': set([session(`${OTHER}/s2`)]) }, 'none') }) });
    const dropping: typeof stripOf = (stored) => {
      const read = stripOf(stored);
      return { ...read, strip: { ...read.strip, panes: read.strip.panes.map((p) => ({ ...p, tabs: p.tabs.filter((t) => !t.id.includes(SENTINEL)) })) as Strip['panes'] } };
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
      [{ stripOf: dropping, storedMain }, 'tab-missing'],
      [{ stripOf, storedMain: moving }, 'sessions-differ'],
      [{ stripOf, storedMain: keyed }, 'not-stored-form'],
      [{ stripOf: throwing, storedMain }, 'internal'],
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
});
