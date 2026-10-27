// The comparison O1 left to O10 (O10 M5; RL §5.5, §6.2, §6.3; P5 Decision Log 20): what a member holds on a session and
// on the machine, against what a command's grade asks. Three kinds that never meet:
//   - a session rank (`list` < `view` < `converse` < `approve` < `manage`) is satisfied by the member's rank on that
//     session at or above it;
//   - a machine grade (`spawn`, `shell`, `machine-admin`) is a right, never ranked, held by the machine's owners (all
//     three) or by a grant naming it;
//   - a routing class (`client`, `internal`) is held by no caller.
// The member's rank on a session is the highest of: `manage` for an owner (`@machine` resolved against the head: the
// machine's member owners, or the admins of an org-owned machine); the grade of the member's share; `view` for an
// `org-view` session and `converse` for an `org-converse` one; `list` for a `listed` one (the default); nothing for a
// `private` one.
import { MACHINE_GRADES, ROUTING_CLASSES, SESSION_RANKS, type Grade, type MachineGrade, type RoutingClass, type SessionRank } from '@shared/ipc/grades';
import { MACHINE_OWNERS, type SessionRecord } from './sources';

export const isSessionRank = (grade: Grade): grade is SessionRank => (SESSION_RANKS as readonly string[]).includes(grade);
export const isMachineGrade = (grade: Grade): grade is MachineGrade => (MACHINE_GRADES as readonly string[]).includes(grade);
export const isRoutingClass = (grade: Grade): grade is RoutingClass => (ROUTING_CLASSES as readonly string[]).includes(grade);

/** Whether `held` (null: nothing) is at or above `needed`. */
export function rankAtLeast(held: SessionRank | null, needed: SessionRank): boolean {
  return held !== null && SESSION_RANKS.indexOf(held) >= SESSION_RANKS.indexOf(needed);
}

/** The higher of two ranks. */
export function higher(a: SessionRank, b: SessionRank): SessionRank {
  return SESSION_RANKS.indexOf(a) >= SESSION_RANKS.indexOf(b) ? a : b;
}

/** Whether `member` owns the session: named in its owners, or one of the machine's owners when they include `@machine`. */
export function owns(record: SessionRecord | null, member: string, machineOwners: readonly string[]): boolean {
  if (record === null) return false;
  return record.owners.includes(member) || (record.owners.includes(MACHINE_OWNERS) && machineOwners.includes(member));
}

/** The member's rank on the session (RL §5.5's holders), or null: no record, or a `private` session they hold nothing on. */
export function sessionRank(record: SessionRecord | null, member: string, machineOwners: readonly string[]): SessionRank | null {
  if (record === null) return null;
  if (owns(record, member, machineOwners)) return 'manage';
  const held: SessionRank[] = (record.shares ?? []).filter((share) => share.member === member).map((share) => share.grade);
  const access = record.access ?? 'listed';
  if (access === 'org-converse') held.push('converse');
  else if (access === 'org-view') held.push('view');
  else if (access === 'listed') held.push('list');
  return held.length === 0 ? null : held.reduce(higher);
}
