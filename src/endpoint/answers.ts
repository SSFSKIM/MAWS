// The read-only commands' answers (`mawsd endpoint status`, `keys` and `policy`, as text or `--json`), rendered from
// plain values: by the module from its state (cli.ts), and by `mawsd` before it loads the module from an unenrolled
// one (presence.ts, P5 Decision Log 114's lever (a)), so the two say the same bytes. It rides `mawsd`'s run path, so it
// imports nothing at run time.
import type { MachineRef } from '@shared/machine/ref';
import type { DelegationFile, EnrollmentFile, PolicyFile, ProvisioningFile } from './state/store';
import type { EndpointStatus } from './status';

export type Policy = PolicyFile;
export type PolicySource = 'set' | 'sminos' | 'default';

export const DEFAULT_POLICY: Policy = { read_only: false, ceiling: 'settings' };

export function statusAnswer(s: EndpointStatus, json: boolean): string {
  if (json) return JSON.stringify(s);
  const lines = [`enrollment: ${s.enrollment}${s.name === undefined ? '' : ` (${s.name} in ${s.org})`}`];
  if (s.stateVersion !== undefined) lines.push(`org state: version ${s.stateVersion}`);
  lines.push(`hub: ${s.hub.connected ? 'connected' : 'not connected'}; channels: ${s.channels.relayed} relayed, ${s.channels.direct} direct; sminos: ${s.rl10.connected ? 'connected' : 'not connected'}`);
  if (s.refusing !== undefined) lines.push(`refusing: ${s.refusing}`);
  return lines.join('\n');
}

/** What `keys` shows: the enrollment (null while there is none), a pending provisioning's redemption, and the key. */
export type KeysOf = {
  ref: MachineRef;
  enrollment: Pick<EnrollmentFile, 'state' | 'name' | 'org'> | null;
  pending: Pick<ProvisioningFile['redeemed'], 'machine' | 'org'> | null;
  delegation: Pick<DelegationFile, 'id'> | null;
  key: { keyId: string; heldKeys: number } | null; // the machine key's id and the ledger's count, while enrolled
  refusing: string | null;
};

export function keysAnswer(of: KeysOf, json: boolean): string {
  const { enrollment, pending, delegation, key, refusing } = of;
  // A redemption whose set is not yet whole is the hub's already (O14 M1), as `status` says it.
  const named = enrollment ?? (pending === null ? null : { name: pending.machine, org: pending.org });
  const view = {
    enrollment: enrollment?.state ?? (pending === null ? 'none' : 'hub-confirmed'),
    ...(named === null ? {} : { name: named.name, org: named.org }),
    ref: of.ref,
    delegated: delegation !== null,
    ...(key === null ? {} : { keyId: key.keyId, heldKeys: key.heldKeys }),
    ...(refusing === null ? {} : { refusing }),
  };
  if (json) return JSON.stringify(view);
  const lines = [`enrollment: ${view.enrollment}`, ...(named === null ? [] : [`machine: ${named.name} in ${named.org}`]), `ref: ${view.ref}`];
  if ('keyId' in view) lines.push(`machine key: ${view.keyId} (${view.heldKeys} held over its enrollments)`);
  if (delegation !== null) lines.push(`delegated: under the delegation ${delegation.id}`);
  if (refusing !== null) lines.push(`refusing its state: ${refusing} (the log names the path)`);
  return lines.join('\n');
}

/** The policy, as `sminos daemon policy` shows it. */
export function policyAnswer(policy: Policy & { source: PolicySource }, json: boolean): string {
  if (json) return JSON.stringify(policy);
  const readOnly = policy.read_only ? 'yes — no remote request above view is served, and nothing written outside this machine is delivered as words' : 'no';
  const ceiling = policy.ceiling === 'settings' ? "settings (from your settings' defaultMode)" : `${policy.ceiling} (set here)`;
  const source = policy.source === 'set' ? '' : policy.source === 'sminos' ? '\n(taken from sminos: no endpoint policy is set)' : '\n(the default: no policy is set)';
  return `read-only: ${readOnly}\nceiling: ${ceiling}${source}`;
}
