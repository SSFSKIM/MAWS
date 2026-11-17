// Whether a machine serves the three git reads, and what a failed read was (UX wave U5b-2,
// docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §E and §H's "Refusals told apart"; decision 19).
// A machine serves `git.branchCommits`, `git.commitDiff` and `git.changesSince` when its `capabilities` list
// `rl2.git-reads`: another machine as its link's handshake lists it, this Mac as main reads its daemon's welcome
// (src/main/machines/git-reads-peer.ts), so the window asks one question of every machine. Its neighbour is
// `servesProjectActs` (sidebar/registry-acts.ts), which reads the same field.
import { GIT_READS_CAPABILITY } from '@shared/ipc/schema/git';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { MachineRef } from '@shared/machine/ref';
import { useMachines } from '../../../stores/machines';

/**
 * True when the machine lists `rl2.git-reads`, false when it lists capabilities without it, null while it lists none yet
 * (its link is not up, this Mac's daemon has not welcomed) and wherever the window holds no roster at all (a mount that
 * never runs `connectShell`, such as the `#panel` harness page).
 */
export function servesReads(machine: MachineRef, machines: ReadonlyMap<MachineRef, Pick<MachineState, 'capabilities'>> = useMachines.getState().machines): boolean | null {
  const capabilities = machines.get(machine)?.capabilities;
  return capabilities === undefined ? null : capabilities.includes(GIT_READS_CAPABILITY);
}

/** The same, followed in a render. */
export const useServesReads = (machine: MachineRef): boolean | null => useMachines((s) => servesReads(machine, s.machines));

/** A failed read as its store keeps it: the message, and the code and the refusal's word where they tell its kind. */
export interface ReadError {
  message: string;
  code?: string; // the IPC code, kept when it is not `internal`
  refusal?: string; // `issues.refusal`, where the machine refused the read
}

/** §H's four kinds of a failed read. */
export type ReadFailure = { kind: 'older' } | { kind: 'offline' } | { kind: 'refused'; refusal: string } | { kind: 'failed'; message: string };

/**
 * What a failed read was, told apart on the path that produced it (decision 19): a machine whose daemon does not know the
 * name (`unknown_command`) or whose endpoint does not offer it (`not-offered`) runs an older MAWS; a machine that did not
 * answer (`host_unavailable`, `timeout`) or whose phase is offline is offline; any other refusal is the machine's; anything
 * else is git's failure, with its message. The machine that lists its capabilities without the reads is `older` too, and
 * is never asked (`servesReads` false).
 */
export function readFailure(error: ReadError, offline: boolean): ReadFailure {
  if (error.code === 'unknown_command' || error.refusal === 'not-offered') return { kind: 'older' };
  if (offline || error.code === 'host_unavailable' || error.code === 'timeout') return { kind: 'offline' };
  if (error.refusal !== undefined) return { kind: 'refused', refusal: error.refusal };
  return { kind: 'failed', message: error.message };
}
