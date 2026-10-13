// The default chain (D9 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md): which system governs an artifact.
// Apart from apply.ts's React and DOM so the host's design-system module (M6) resolves the chain for the agent with
// nothing but this; apply.ts re-exports it, where the ledger's X28 names it.

/** A system by id: live when `versionSeq` is absent; X29's pin (a retained state of it) when present. */
export type DesignSystemRef = { id: string; versionSeq?: number };

/**
 * The system governing an artifact (D9): its own `designSystemId`, else its Space's default, else the owner's default,
 * else the house system, else the bundled floor. `live` tells a system that exists; a deleted or missing id is skipped
 * down the chain, never an error. Without it every id is taken as live.
 */
export function governingSystem(
  a: { designSystemId?: string | null; spaceId?: string | null },
  d: { owner: string | null; spaces: Record<string, string>; house: string | null },
  live: (id: string) => boolean = () => true,
): DesignSystemRef | { builtin: 'maws' } {
  const space = a.spaceId != null && Object.hasOwn(d.spaces, a.spaceId) ? d.spaces[a.spaceId] : undefined;
  for (const id of [a.designSystemId, space, d.owner, d.house]) if (id && live(id)) return { id };
  return { builtin: 'maws' };
}
