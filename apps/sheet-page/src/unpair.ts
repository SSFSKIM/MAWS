// The person's own Unpair (§P; T10, T19). The revocation is asked of mawsd over a proven connection, and at once, before
// any answer, the connection ends and the pairing being removed is forgotten (that pairing: one another tab stored since
// is left), so a person who sees the pairing screen and closes the tab leaves no credential behind, and an answer that
// lands late erases nothing. The answer only says what became of the pairing on mawsd's side, since each asks something
// different of the person: `revoked`, mawsd refused it and saved that; `not-saved`, mawsd refuses it now but could not
// save the change, so a restart before a save may accept the old pairing again; `local`, mawsd did not confirm the
// removal (no proven connection, no answer in time, or a refusal), which can also mean it was already gone, so mawsd may
// or may not still list it.
import type { Api, Done } from './api';
import { forgetPairing, type StoredPairing } from './credential';
import { forgetUnkept } from './memory';

// `refused`: the connection's opening was refused, or another tab of this browser unpaired it
export type Unpaired = 'refused' | 'revoked' | 'not-saved' | 'local';

export function unpairThisBrowser(deps: { pairing: StoredPairing | null; unpair(): Promise<Done>; close(): void; forget(pairing: StoredPairing | null): void }): Promise<Unpaired> {
  const told = deps.unpair(); // its request leaves now, with the credential the connection proved
  deps.close();
  deps.forget(deps.pairing);
  return told.then((done) => (done.ok ? 'revoked' : done.why === 'not-saved' ? 'not-saved' : 'local'));
}

/**
 * The person's Unpair as the page's menu does it: of the pairing the screen shows (`shown`, the one this tab's connection
 * opened with), never of whichever storage holds now, since another tab may have stored a newer one this tab has not yet
 * heard of. The revocation is asked only while the live proof is that same pairing's, and only it is forgotten.
 */
export function unpairScreen(deps: { shown: StoredPairing | null; api: Pick<Api, 'unpair'>; close(): void; storage?: Storage }): Promise<Unpaired> {
  const { shown, api, storage } = deps;
  return unpairThisBrowser({
    pairing: shown,
    unpair: () => (shown === null ? Promise.resolve({ ok: false, why: 'unproven' }) : api.unpair(shown)),
    close: deps.close,
    forget: (pairing) => {
      if (forgetPairing(pairing, storage)) forgetUnkept(storage);
    },
  });
}
