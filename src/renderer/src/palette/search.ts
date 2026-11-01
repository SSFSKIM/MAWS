// Conversation search across machines (P5 O7 M6, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6 "Search"):
// the palette's query goes to this Mac and to each RL2 machine that is up, whose endpoint answers `session.search` for
// the sessions this member may view; the hits come back under their machine, this Mac's first, then the roster's order.
// A machine that can't answer is left out with no error: `host_unavailable` (offline or unreachable, or an endpoint older
// than M6, whose refusal main answers so). This Mac's own failure, and any other machine's, is said with its machine.
import type { IpcError } from '@shared/ipc/errors';
import type { CommandOutput, MawsBridge } from '@shared/ipc/schema';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';

export type SearchHit = CommandOutput<'session.search'>['hits'][number];

export interface ConversationSearch {
  groups: { machine: MachineRef; hits: SearchHit[] }[]; // every machine that answered, in the order asked
  indexing: boolean; // some machine is still indexing (the palette asks again)
  incomplete: boolean; // some machine could not index every conversation
  errors: { machine: MachineRef; message: string }[];
}

// The RL2 machines (the org rows' roster) whose link is up, in the roster's order.
export function searchedMachines(rl2: ReadonlySet<MachineRef>, roster: ReadonlyMap<MachineRef, Pick<MachineState, 'state'>>): MachineRef[] {
  return [...roster].filter(([ref, entry]) => rl2.has(ref) && entry.state === 'up').map(([ref]) => ref);
}

const leftOut = (error: IpcError): boolean => error.code === 'host_unavailable';

export async function searchConversations(client: MawsBridge, query: string, machines: readonly MachineRef[]): Promise<ConversationSearch> {
  const local = client.localMachine;
  const ask = (machine: MachineRef | null) =>
    (machine === null ? client.invoke('session.search', { query }) : client.invoke('session.search', { query }, { machine })).catch(
      (error: unknown) => ({ ok: false as const, error: { code: 'internal' as const, message: String(error) } }),
    );
  const answers = await Promise.all([ask(null), ...machines.map(ask)]);
  const result: ConversationSearch = { groups: [], indexing: false, incomplete: false, errors: [] };
  answers.forEach((answer, i) => {
    const machine = i === 0 ? local : machines[i - 1];
    if (answer.ok) {
      result.groups.push({ machine, hits: answer.value.hits });
      result.indexing ||= answer.value.indexing;
      result.incomplete ||= answer.value.incomplete;
    } else if (i === 0 || !leftOut(answer.error)) result.errors.push({ machine, message: answer.error.message });
  });
  return result;
}
