// This Mac's one owner in the app's held head (P5 O8 M5b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, the
// architect's rulings on M5b's refresh, item 1, and the Decision Log's "M5b Task 1, the renderer"), for Share and "Add
// owner…" on this Mac's own sessions (sessions/share/target.ts). This Mac's `record.policy` answers as its owners'
// member: it names every session any of them owns, while the local door authorizes an act as the signed-in device's
// member, and `manage` is the session's owners' alone (src/endpoint/grades.ts). With the signed-in member this Mac's only
// owner (a member list of one, or an org-owned Mac whose admins are one), the sessions the read names are theirs. Null
// otherwise, and while no view is held.
//
// A hint, not the check: this is the app's head, and mawsd's can lag or lead it, so for a moment the app can name you
// the one owner while the door, under its own head, refuses you. The door decides.
//
// The view moves only at `org.changed` (as the Org page reads it): it is read at connect and again at each, the latest
// read kept.
import { create } from 'zustand';
import type { MawsBridge } from '@shared/ipc/schema';
import type { OrgView } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';

export const useLocalOwner = create<{ owner: string | null }>()(() => ({ owner: null }));

/** The member who alone owns `local` in `view`, or null: none, several, or no entry for it. */
export function soleOwnerOf(view: OrgView | null, local: MachineRef): string | null {
  const entry = view?.machines.find((m) => m.ref === local);
  if (view === null || entry === undefined) return null;
  const owners = entry.owners === 'org' ? view.members.filter((m) => m.role === 'admin').map((m) => m.id) : entry.owners;
  return owners.length === 1 ? owners[0] : null;
}

export function connectLocalOwner(client: MawsBridge = ipc): () => void {
  let live = true;
  let asked = 0;
  const read = () => {
    const at = ++asked;
    void client.invoke('org.view', undefined).then((result) => {
      if (!live || at !== asked) return;
      if (!result.ok) console.warn("[local-owner] org.view unavailable; this Mac's sessions offer no Add owner", result.error);
      useLocalOwner.setState({ owner: result.ok ? soleOwnerOf(result.value, client.localMachine) : null });
    });
  };
  const off = client.on('org.changed', read);
  read();
  return () => {
    live = false;
    off();
  };
}
