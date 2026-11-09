// A new delegation's judges before anything is minted or signed, moved here from the hub's `deploy/admin.ts` (P5 O8 M4c,
// "The move") so the app's create transaction refuses what `deployment admin delegation create` refuses, in its words:
// a prefix the state already holds, nests with, or names a machine under; and a mint answer that differs from what the
// owner approved. The provisioning key's bounds and the delegation's "no cap" and "never" live here too, since the
// app's main imports nothing from the hub; the hub's identity file re-exports them.
import { machineNameKey } from './names.ts';
import { printable } from './printable.ts';
import type { OrgState } from './types.ts';

export const MIN_PROVISIONING_KEY_TTL_S = 3600;
export const MAX_PROVISIONING_KEY_TTL_S = 31_536_000; // a year
export const MAX_PROVISIONING_KEY_USES = 10_000;
/**
 * A provisioning key's "no cap" (`max_uses` null) as a delegation's `maxUses`, and its "never" (`offline_revoke_s` null)
 * as `offlineRevokeS`: 0, which no real offline time can be (the hub's `MIN_OFFLINE_REVOKE_S`).
 */
export const NO_USE_CAP = Number.MAX_SAFE_INTEGER;
export const NEVER_OFFLINE = 0;

/** Why `prefix` cannot be a new delegation's in `state` (RL DL 25, 26; org-state.ts's name namespaces), or null. */
export function prefixProblem(state: OrgState, prefix: string): string | null {
  const key = machineNameKey(prefix);
  const held = [
    ...state.delegations.map((d) => ({ id: d.id, prefix: d.prefix, dropped: false })),
    ...state.revoked.flatMap((r) => ('delegation' in r.holder ? [{ id: r.holder.delegation, prefix: r.holder.prefix, dropped: true }] : [])),
  ];
  for (const d of held) {
    const theirs = machineNameKey(d.prefix);
    const whose = d.dropped ? `the dropped delegation ${d.id}'s` : `delegation ${d.id}'s`;
    const reserved = d.dropped ? ', reserved for the life of the org' : '';
    if (theirs === key) return `the prefix ${prefix} is ${whose}${reserved}`;
    if (theirs.startsWith(key) || key.startsWith(theirs)) return `the prefix ${prefix} nests with ${whose} ${d.prefix}${reserved}`;
  }
  const under = [...state.machineNames, ...state.machines].find((m) => machineNameKey(m.name).startsWith(key));
  return under ? `the machine ${under.name} is named under the prefix ${prefix}` : null;
}

/**
 * What `mintDisagrees` reads of the hub's answer to `POST /api/provisioning-keys` (the hub's `ProvisioningKeyIssued` is
 * one). Each field is judged, since the answer is the hub's word: nothing here trusts its grammar.
 */
export type MintAnswer = { key?: { id?: unknown; prefix?: unknown; expires?: unknown; max_uses?: unknown } | null; token?: unknown };

/** How far the hub's clock may stand from this one's when its mint answer states the key's expiry. */
export const MINT_SKEW_MS = 60_000;

/**
 * Where the hub's answer to a provisioning key's mint differs from what the owner approved; empty when it does not.
 * `ttl` is in seconds; `before` and `after` are the epoch milliseconds taken around the request.
 */
export function mintDisagrees(issued: MintAnswer | null, approved: { prefix: string; ttl: number; maxUses: number | null; before: number; after: number }): string[] {
  const key = issued?.key;
  if (typeof key !== 'object' || key === null) return ['no key in it'];
  const out: string[] = [];
  if (typeof key.id !== 'string' || !/^[0-9a-f]{32}$/.test(key.id)) out.push(`its id ${printable(String(key.id))} is not 32 hex`);
  if (key.prefix !== approved.prefix) out.push(`its prefix ${printable(String(key.prefix))}, not the ${approved.prefix} you approved`);
  const expires = typeof key.expires === 'string' ? Date.parse(key.expires) : NaN;
  const earliest = approved.before + approved.ttl * 1000 - MINT_SKEW_MS;
  const latest = approved.after + approved.ttl * 1000 + MINT_SKEW_MS;
  if (!(expires >= earliest && expires <= latest)) {
    out.push(`it expires at ${printable(String(key.expires))}, not within ${MINT_SKEW_MS / 1000} s of ${new Date(approved.before + approved.ttl * 1000).toISOString()}`);
  }
  if (key.max_uses !== approved.maxUses) {
    const theirs = key.max_uses === null ? 'no use limit' : `a limit of ${printable(String(key.max_uses))} uses`;
    out.push(`${theirs}, not the ${approved.maxUses === null ? 'no limit' : approved.maxUses} you approved`);
  }
  const token = issued?.token;
  if (typeof token !== 'string' || token === '') out.push('no token');
  return out;
}
