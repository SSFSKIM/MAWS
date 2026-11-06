// The signed-in member's policy rows (P5 O18 M2b): for each private session whose audience holds them, its audience
// and `policyRev` as the hub's registry holds them, from the registry socket (`hub/grid-client.ts`): the whole set at
// each connection, then each change. What a project's words toward a private session are sealed with
// (`project/audience.ts`). Held for the tab's life; a dropped socket keeps the last rows until the next set, the hub
// refusing at `takeHuman` what a stale one gets wrong.
import { isAudience } from 'org-protocol';
import type { MemberPolicy, PoliciesFrame, PolicyFrame } from 'desk-hub/protocol';

let rows = new Map<string, MemberPolicy>();

const isRow = (value: unknown): value is MemberPolicy => {
  const v = value as Partial<MemberPolicy> | null;
  return typeof v === 'object' && v !== null && isAudience(v.audience) && Number.isSafeInteger(v.policyRev) && (v.policyRev as number) >= 0;
};

/** The rows held now, by session. */
export const policyRows = (): ReadonlyMap<string, MemberPolicy> => rows;

export function takePolicies(frame: PoliciesFrame | PolicyFrame): void {
  if (frame.t === 'policies') {
    const next = new Map<string, MemberPolicy>();
    for (const row of Array.isArray(frame.rows) ? frame.rows : []) {
      if (typeof row?.session === 'string' && isRow(row)) next.set(row.session, { audience: row.audience, policyRev: row.policyRev });
    }
    rows = next;
    return;
  }
  if (typeof frame.session !== 'string') return;
  if (frame.policy === null) {
    rows = new Map(rows);
    rows.delete(frame.session);
  } else if (isRow(frame.policy)) {
    rows = new Map(rows).set(frame.session, { audience: frame.policy.audience, policyRev: frame.policy.policyRev });
  }
}

/** Forgets every row (the suites). */
export function clearPolicyRows(): void {
  rows = new Map();
}
