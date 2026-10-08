// The teammates of this session and their place in the topology tree (E7 execution document, Design §5; Decision Log 7,
// 24). The roster is the engine's own statement: the `Teammates` section of the newest `ListAgents` listing the
// transcript's activity holds (the activity sees backfill and live across launches; the task graph does not). In the
// tree, an active root (running, or with a running descendant) whose own name (the sidecar's `name`, never the
// description) is a teammate's moves under one `team` header first among the running roots, with its subtree; a
// teammate no listed agent matches is a `roster` row there (no transcript to open). A finished teammate stays under
// Done, as any finished root does, so the running-first order and the collapsed Done hold (the architect's ruling, M4
// review). M0's team probe on 2.1.291 listed none (a named agent lists under Subagents), so this ships tested on
// hand-built listings, unverified live. Pure.
import type { TurnActivity } from '../../../transcript/model/activity';
import { listedAgent, type AgentTree, type TaskGraph, type TreeRow } from './task-graph';

export interface Teammate {
  name: string;
  ref: string | null;
  extras: string[]; // the row's extras as listed (agent type, status or backend, `joined <duration> ago`, notes)
  at: string; // when the listing that names it was called
}

export function teammatesOf(activity: readonly Pick<TurnActivity, 'listings'>[]): Map<string, Teammate> {
  const newest = activity.flatMap((turn) => turn.listings).findLast((listing) => listing.parsed !== null);
  const section = newest?.parsed?.sections.find((s) => s.title === 'Teammates');
  return new Map((section?.rows ?? []).map((row) => [row.name, { name: row.name, ref: row.ref, extras: row.extras, at: newest!.at }]));
}

// A section's rows cut into root blocks: each depth-0 row with the deeper rows under it.
function blocks(rows: readonly TreeRow[]): TreeRow[][] {
  const out: TreeRow[][] = [];
  for (const row of rows) {
    if (row.depth === 0 || out.length === 0) out.push([row]);
    else out[out.length - 1]!.push(row);
  }
  return out;
}

// The tree with its teammates grouped; the same object when nothing is grouped and no roster row is drawn.
export function withTeam(tree: AgentTree, graph: TaskGraph, roster: ReadonlyMap<string, Teammate>): AgentTree {
  if (roster.size === 0) return tree;
  const nameOf = (row: TreeRow) => (row.kind === 'agent' ? (graph.tasks.get(row.taskId)?.agent?.name ?? null) : null);
  const isTeammate = (block: TreeRow[]) => {
    const name = nameOf(block[0]!);
    return name !== null && roster.has(name);
  };
  const agentBlocks = blocks(tree.agents); // the active roots: Done's finished teammates stay where they are
  const members = agentBlocks.filter(isTeammate);
  const matched = new Set([...graph.tasks.values()].filter(listedAgent).map((n) => n.agent?.name ?? null));
  const unmatched = [...roster.values()].filter((mate) => !matched.has(mate.name));
  if (members.length === 0 && unmatched.length === 0) return tree;
  return {
    agents: [
      { kind: 'team', depth: 0 },
      ...members.flat().map((row) => ({ ...row, depth: row.depth + 1 })),
      ...unmatched.map((mate): TreeRow => ({ kind: 'roster', ...mate, depth: 1 })),
      ...agentBlocks.filter((block) => !isTeammate(block)).flat(),
    ],
    done: tree.done,
    running: tree.running,
  };
}
