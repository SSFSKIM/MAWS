// The history list's model (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7): versions grouped by
// day newest first (Today, Yesterday, then dates), runs of automatic versions folded, the Named only filter, each
// row's title and summary, an actor key's author, and when "See N new changes" is offered and from which version.
import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '@shared/artifacts/version';
import { actorDisplay } from '@shared/artifacts/actor';
import { authorOf, groupVersions, newChangesBase, versionSummary, versionTitle } from './model';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const NOW = new Date(2026, 9, 12, 15, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
let n = 0;
const v = (fields: Partial<ArtifactVersion> & Pick<ArtifactVersion, 'at'>): ArtifactVersion => ({
  id: ++n,
  seq: n * 10,
  actor: { kind: 'human' },
  kind: 'auto',
  assetRefs: [],
  ...fields,
});

describe('grouping', () => {
  it('groups by day newest first: Today, Yesterday, then dates', () => {
    const versions = [v({ at: at(10, 9) }), v({ at: at(12, 14), kind: 'named', label: 'Draft' }), v({ at: at(11, 16), kind: 'turn' }), v({ at: at(12, 9), kind: 'turn' })];
    const groups = groupVersions(versions, { now: NOW });
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'October 10']);
    expect(groups[0].entries.map((e) => (e.kind === 'version' ? e.version.at : null))).toEqual([at(12, 14), at(12, 9)]);
  });

  it('names a date of another year with its year', () => {
    expect(groupVersions([v({ at: new Date(2025, 11, 30, 9).getTime() })], { now: NOW })[0].label).toBe('December 30, 2025');
  });

  it('folds a run of automatic versions under its newest, and leaves a lone one', () => {
    const named = v({ at: at(12, 14), kind: 'named', label: 'Draft' });
    const autos = [v({ at: at(12, 13) }), v({ at: at(12, 12) }), v({ at: at(12, 11) })];
    const turn = v({ at: at(12, 10), kind: 'turn' });
    const lone = v({ at: at(12, 9) });
    const [today] = groupVersions([lone, turn, ...autos, named], { now: NOW });
    expect(today.entries.map((e) => (e.kind === 'run' ? e.versions.map((x) => x.id) : e.version.id))).toEqual([named.id, autos.map((x) => x.id), turn.id, lone.id]);
  });

  it('filters to named versions', () => {
    const named = v({ at: at(12, 14), kind: 'named', label: 'Draft' });
    const labelled = v({ at: at(12, 13), kind: 'auto', label: 'Before the review' });
    const groups = groupVersions([v({ at: at(12, 12) }), named, labelled, v({ at: at(11, 9), kind: 'turn' })], { now: NOW, namedOnly: true });
    expect(groups.flatMap((g) => g.entries.map((e) => (e.kind === 'version' ? e.version.id : -1)))).toEqual([named.id, labelled.id]);
  });
});

describe('a row', () => {
  it('is titled by its label, else its time', () => {
    expect(versionTitle(v({ at: at(12, 9, 41), label: 'Draft to legal' }))).toBe('Draft to legal');
    expect(versionTitle(v({ at: at(12, 9, 41) }))).toBe('9:41 AM');
  });

  it('is summarised by its summary, else its note’s first line, else what made it', () => {
    expect(versionSummary(v({ at: 0, kind: 'turn', summary: 'Replaced 1 sentence; inserted 2 blocks' }))).toBe('Replaced 1 sentence; inserted 2 blocks');
    expect(versionSummary(v({ at: 0, kind: 'named', label: 'Draft', note: 'Ready for legal\nwith the appendix' }))).toBe('Ready for legal');
    expect(versionSummary(v({ at: 0, kind: 'import' }))).toBe('Imported');
    expect(versionSummary(v({ at: 0, kind: 'auto' }))).toBeNull();
  });

  // P4 W1-B (the tracker's "P4 version history lines"): a turn's tool lines name blocks (^id) and comments (c:id) by
  // the words the rail's live document gives them, "a block" or "a comment" for one it no longer holds, and count in
  // words; a line no tool wrote (a deck's publish line) and a note are shown as written
  it('reads a turn’s tool lines in words, never ids', () => {
    const words = { block: (id: string) => ({ p1: '“Intro”', p2: '“Next”', p3: 'the table “Region, Q1”' })[id] ?? null, thread: (id: string) => (id === 't1' ? '“Intro”' : null) };
    const line = (summary: string) => versionSummary(v({ at: 0, kind: 'turn', summary }), words);
    const bare = (summary: string) => versionSummary(v({ at: 0, kind: 'turn', summary })); // no live document given
    expect(line('replaced ^p1')).toBe('Rewrote “Intro”');
    expect(line('replaced ^p1 (+1 blocks)')).toBe('Rewrote “Intro” and added 1 block');
    expect(line('inserted 1 block(s) after ^p1: ^p2')).toBe('Inserted “Next” after “Intro”');
    expect(line('inserted 3 block(s) before ^p1: ^n1 ^n2 ^n3')).toBe('Inserted 3 blocks before “Intro”');
    expect(line('deleted ^gone')).toBe('Deleted a block');
    expect(line('replaced 1 occurrence(s) in ^p1')).toBe('Edited “Intro”');
    expect(line('replaced 3 occurrence(s) in ^p1, ^p2')).toBe('Edited “Intro” and “Next”');
    expect(line('replaced 4 occurrence(s) in ^p1, ^p2, ^p3, ^?')).toBe('Edited “Intro” and 3 more blocks');
    expect(line('moved ^p2 after the start')).toBe('Moved “Next” to the start');
    expect(line('moved ^p2 after ^p1 (by moving ^p1; a human is typing in ^p2)')).toBe('Moved “Next” after “Intro”');
    expect(line('^p2 already after ^p1')).toBe('Kept “Next” in place');
    expect(line('set cell (0, 2) of ^p3')).toBe('Edited row 1, column 3 of the table “Region, Q1”');
    expect(line('set cell (0, 2) of ^gone')).toBe('Edited row 1, column 3 of a table');
    expect(line('replied on c:t1\nresolved c:t1')).toBe('Replied to the comment on “Intro”'); // the first line
    expect(line('resolved c:t1')).toBe('Resolved the comment on “Intro”');
    expect(line('reopened c:gone')).toBe('Reopened a comment');
    expect(bare('replied on c:t1')).toBe('Replied to a comment');
    expect(bare('replaced 1 occurrence(s) in ^p1')).toBe('Edited a block');
    expect(line('1 edits')).toBe('1 edit'); // a summary stored before summarizeTurn counted in words
    expect(line('Published 1 slide (1 changed, 0 added, 0 removed)')).toBe('Published 1 slide (1 changed, 0 added, 0 removed)');
    expect(versionSummary(v({ at: 0, kind: 'named', label: 'Draft', note: 'deleted ^p1 on purpose' }), words)).toBe('deleted ^p1 on purpose');
  });

  it('names its author as actorDisplay does, with a session’s title when known', () => {
    expect(authorOf('human')).toEqual(actorDisplay({ kind: 'human' }));
    const session = { kind: 'session', appSessionId: SESSION } as const;
    expect(authorOf(`session:${SESSION}`, () => 'Fix the build')).toEqual(actorDisplay(session, 'Fix the build'));
    expect(authorOf(`session:${SESSION}`).name).toBe('Claude');
  });
});

describe('See N new changes', () => {
  it('uses the seen revision even when a seen auto version is upgraded with a later timestamp', () => {
    const seen = v({ id: 1, seq: 10, at: at(12, 12), kind: 'turn', actor: { kind: 'session', appSessionId: SESSION } });
    expect(newChangesBase([seen], at(12, 10), 10)).toBeNull();
    const next = v({ id: 2, seq: 11, at: at(12, 13), kind: 'auto', actor: { kind: 'session', appSessionId: SESSION } });
    expect(newChangesBase([seen, next], at(12, 10), 10)).toEqual({ since: seen });
  });

  const session = { kind: 'session', appSessionId: SESSION } as const;
  it('is offered for an automatic or turn version by a session after the last view, from the version at that view', () => {
    const seen = v({ at: at(12, 9) });
    const older = v({ at: at(12, 8) });
    const agent = v({ at: at(12, 11), kind: 'turn', actor: session });
    expect(newChangesBase([older, seen, agent], at(12, 10))).toEqual({ since: seen });
  });

  it('is not offered when only the owner changed it since, or nothing did, or it was never viewed', () => {
    const seen = v({ at: at(12, 9) });
    expect(newChangesBase([seen, v({ at: at(12, 11), actor: { kind: 'human' } })], at(12, 10))).toBeNull();
    expect(newChangesBase([seen, v({ at: at(12, 8), kind: 'turn', actor: session })], at(12, 10))).toBeNull();
    expect(newChangesBase([seen, v({ at: at(12, 11), kind: 'named', label: 'x', actor: session })], at(12, 10))).toBeNull();
    expect(newChangesBase([v({ at: at(12, 11), kind: 'turn', actor: session })], null)).toBeNull();
  });

  it('compares with nothing when no version predates the last view', () => {
    expect(newChangesBase([v({ at: at(12, 11), kind: 'turn', actor: session })], at(12, 10))).toEqual({ since: null });
  });
});
