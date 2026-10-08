// The teammates' roster from the transcript's listings and its grouping in the topology tree (E7 execution document,
// Design §5; Decision Log 7, 24): M0's recorded listings name no teammate (a named agent lists under Subagents on
// 2.1.291, through MAWS's SDK launch); E11's S2(d) recorded a team an interactive terminal formed under the teams gate on
// 2.1.293 (pass3/e7-team-terminal), which pins the read; the hand-built `Teammates` sections keep what it does not hold
// (several teammates, a ref-less row, a newer listing replacing an older).
import { describe, expect, it } from 'vitest';
import type { TaskId } from '@shared/graph/ids';
import { event, recordedTeamListing } from '../../../../../../test/support/agents-events';
import { loadJournal } from '../../../../../../test/support/fixtures';
import type { TurnActivity } from '../../../transcript/model/activity';
import { parseListing } from '../../../transcript/model/agent-listing';
import { agentTree, applyTaskEvents, emptyGraph, mergeSidecars, type TaskGraph } from './task-graph';
import { teammatesOf, withTeam } from './teammates';

type Listings = Pick<TurnActivity, 'listings'>;
const T = '2026-10-06T10:00:00.000Z';
const listingTurn = (texts: (string | null)[], at = T): Listings => ({
  listings: texts.map((text, i) => ({ toolUseId: `l${i}` as never, at, parsed: text === null ? null : parseListing(text) })),
});
const recorded = (name: string, seq: number) => {
  const frame = loadJournal('pass3', name).find((row) => row.seq === seq)!.frame as { message: { content: { content: string }[] } };
  return frame.message.content[0]!.content;
};
const SELF = 'This session is lead-07 [aa11bb] — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).';
const team = (...rows: string[]) => [SELF, '', `Teammates (${rows.length}):`, ...rows.map((row) => `  ${row}`)].join('\n');

describe('teammatesOf', () => {
  it('names no teammate from M0’s recorded listings (peer sessions; a named agent under Subagents)', () => {
    expect(teammatesOf([listingTurn([recorded('e7-peer-a', 29)]), listingTurn([recorded('e7-team', 98)])])).toEqual(new Map());
  });

  it('reads the Teammates section of the recorded team (an interactive terminal under the teams gate, E11 S2(d))', () => {
    expect(teammatesOf([listingTurn([recordedTeamListing()])])).toEqual(new Map([
      ['scout', { name: 'scout', ref: '874319', extras: ['general-purpose', 'running', 'started 0s ago'], at: T }],
    ]));
  });

  it('reads the newest listing’s Teammates section: name, ref and every extra the row carries, at the listing’s time', () => {
    const older = listingTurn([team('scout [15083b]  ·  general-purpose  ·  in-process  ·  joined 4m ago')], '2026-10-06T09:00:00.000Z');
    const newer = listingTurn([
      team('researcher [9c1f00]  ·  Explore  ·  in-process  ·  joined 1m ago', 'tester  ·  general-purpose  ·  idle  ·  joined 9m ago'),
      null, // a listing still waiting for its result says nothing yet
    ]);
    expect(teammatesOf([older, newer])).toEqual(new Map([
      ['researcher', { name: 'researcher', ref: '9c1f00', extras: ['Explore', 'in-process', 'joined 1m ago'], at: T }],
      ['tester', { name: 'tester', ref: null, extras: ['general-purpose', 'idle', 'joined 9m ago'], at: T }],
    ]));
  });

  it('a newer listing without a Teammates section empties the roster', () => {
    const older = listingTurn([team('scout [15083b]  ·  general-purpose  ·  in-process  ·  joined 4m ago')], '2026-10-06T09:00:00.000Z');
    expect(teammatesOf([older, listingTurn([recorded('e7-team', 98)])])).toEqual(new Map());
    expect(teammatesOf([])).toEqual(new Map());
  });
});

describe('withTeam', () => {
  const start = (taskId: string, seq: number) => event('subagent.started', { taskId, agentId: taskId, toolUseId: `tu_${taskId}`, description: `Agent ${taskId}` }, { seq });
  const issue = (by: string, toolUseId: string, seq: number) => event('tool.use', { toolName: 'Agent', toolUseId, agentId: by }, { seq });
  const finish = (taskId: string, seq: number, at: string) => event('subagent.finished', { taskId, agentId: taskId }, { seq, at });
  // The sidecar's `name` is the one the tree matches a teammate by (`AgentFacts.name`).
  const named = (graph: TaskGraph, names: Record<string, string>): TaskGraph =>
    mergeSidecars(graph, Object.entries(names).map(([agentId, name]) => ({
      agentId: agentId as never, meta: { agentType: 'general-purpose', description: `Agent ${agentId}`, name }, transcriptPath: `/x/agent-${agentId}.jsonl`, size: 1, mtimeMs: 1, runId: null,
    })));
  const roster = (...names: string[]) => new Map(names.map((name) => [name, { name, ref: null, extras: ['general-purpose', 'idle'], at: T }]));
  const agent = (taskId: string, depth: number, over: Record<string, unknown> = {}) => ({ kind: 'agent', taskId, depth, parentTaskId: null, orphan: false, foldedUnder: null, ...over });

  it('groups the active teammates (with their subtrees) under one header first among the running roots, then the roster rows no agent matches; a finished teammate stays under Done', () => {
    const graph = named(applyTaskEvents(emptyGraph(), [
      start('S', 1), start('R', 2), issue('R', 'tu_K', 3), start('K', 4), start('D', 5), finish('D', 6, '2026-10-06T10:00:06.000Z'),
    ]), { R: 'researcher', D: 'tester' });
    const tree = withTeam(agentTree(graph), graph, roster('researcher', 'tester', 'ghost'));
    expect(tree).toEqual({
      agents: [
        { kind: 'team', depth: 0 },
        agent('R', 1), agent('K', 2, { parentTaskId: 'R' }),
        { kind: 'roster', name: 'ghost', ref: null, extras: ['general-purpose', 'idle'], at: T, depth: 1 },
        agent('S', 0),
      ],
      done: [agent('D', 0)], // matched by name, so no roster row either
      running: 3,
    });
  });

  it('draws no header when every matched teammate has finished and none is unmatched: they stay under Done', () => {
    const graph = named(applyTaskEvents(emptyGraph(), [start('S', 1), start('D', 2), finish('D', 3, '2026-10-06T10:00:03.000Z')]), { D: 'tester' });
    const tree = agentTree(graph);
    expect(withTeam(tree, graph, roster('tester'))).toBe(tree);
    expect(tree.done).toEqual([agent('D', 0)]);
  });

  it('matches by the agent’s own name only, and only a root: a nested agent of that name stays where it is, and no header is drawn over nothing', () => {
    const graph = named(applyTaskEvents(emptyGraph(), [start('P', 1), issue('P', 'tu_C', 2), start('C', 3)]), { C: 'researcher', P: 'planner' });
    const tree = agentTree(graph);
    expect(withTeam(tree, graph, roster('researcher')).agents).toEqual([agent('P', 0), agent('C', 1, { parentTaskId: 'P' })]);
    expect(withTeam(tree, graph, roster('Agent P')).agents.map((row) => row.kind), 'the description is no name: a roster row, P where it was').toEqual(['team', 'roster', 'agent', 'agent']);
  });

  it('keeps the tree as it is without a roster, or when every teammate is known only on disk', () => {
    const graph = applyTaskEvents(emptyGraph(), [start('S', 1)]);
    const tree = agentTree(graph);
    expect(withTeam(tree, graph, new Map())).toBe(tree);
    const onDisk = named(emptyGraph(), { X: 'researcher' });
    expect(withTeam(agentTree(onDisk), onDisk, roster('researcher'))).toBe(agentTree(onDisk));
  });

  it('draws a teammate no agent matches as a roster row even when nothing else runs', () => {
    const graph = emptyGraph();
    expect(withTeam(agentTree(graph), graph, roster('ghost')).agents).toEqual([
      { kind: 'team', depth: 0 }, { kind: 'roster', name: 'ghost', ref: null, extras: ['general-purpose', 'idle'], at: T, depth: 1 },
    ]);
  });

  it('shifts a teammate’s fold with it', () => {
    const graph = named(applyTaskEvents(emptyGraph(), [start('R', 1), issue('R', 'tu_D', 2), start('D', 3), finish('D', 4, '2026-10-06T10:00:04.000Z')]), { R: 'researcher' });
    expect(withTeam(agentTree(graph), graph, roster('researcher')).agents).toEqual([
      { kind: 'team', depth: 0 }, agent('R', 1), { kind: 'done-fold', parentTaskId: 'R' as TaskId, count: 1, depth: 2, expanded: false },
      agent('D', 2, { parentTaskId: 'R', foldedUnder: 'R' }),
    ]);
  });
});
