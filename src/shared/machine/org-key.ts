// An org project's key (P5 O6 M5, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The derivation";
// OX3): the persisted identity of a project across machines, which enrollment never changes. `smns:<project>` for a
// `.smns`, `remote:<remote key>` for a repository's remote, `repo:<ref>:<hash>` and `folder:<ref>:<project id>` for
// what only one machine names, `machine:<ref>` for a machine's own project. Every prefix ends in `:`, which a
// `MachineRef` cannot hold, so a key is never an address (`./address.ts`): a project key that is an address is one
// from before M5, still to migrate. A brand is type-only, so the schema renders as the plain string it was.
import * as z from 'zod';
import type { MachineRef } from './ref';

export const OrgKeySchema = z.string().min(1).brand<'OrgKey'>();
export type OrgKey = z.infer<typeof OrgKeySchema>;

const PREFIXES = ['smns:', 'remote:', 'repo:', 'folder:', 'machine:'] as const;

export const isOrgKey = (value: string): value is OrgKey => PREFIXES.some((prefix) => value.startsWith(prefix) && value.length > prefix.length);

// A machine's own project's key, where its sessions with no checkout sit.
export const machineKey = (machine: MachineRef): OrgKey => `machine:${machine}` as OrgKey;
