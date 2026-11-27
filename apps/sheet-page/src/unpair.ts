// The person's own Unpair (§P; T10, T19). The revocation is asked of mawsd over a proven connection, and at once, before
// any answer, the connection ends and the pairing being removed is forgotten (that pairing: one another tab stored since
// is left), so a person who sees the pairing screen and closes the tab leaves no credential behind, and an answer that
// lands late erases nothing. The answer only says what became of the pairing on mawsd's side, since each asks something
// different of the person: `revoked`, mawsd refused it and saved that; `not-saved`, mawsd refuses it now but could not
// save the change, so a restart before a save may accept the old pairing again; `local`, mawsd did not confirm the
// removal (no proven connection, no answer in time, or a refusal), which can also mean it was already gone, so mawsd may
// or may not still list it.
import type { Done } from './api';
import type { StoredPairing } from './credential';

// `refused`: the connection's opening was refused, or another tab of this browser unpaired it
export type Unpaired = 'refused' | 'revoked' | 'not-saved' | 'local';

export function unpairThisBrowser(deps: { pairing: StoredPairing | null; unpair(): Promise<Done>; close(): void; forget(pairing: StoredPairing | null): void }): Promise<Unpaired> {
  const told = deps.unpair(); // its request leaves now, with the credential the connection proved
  deps.close();
  deps.forget(deps.pairing);
  return told.then((done) => (done.ok ? 'revoked' : done.why === 'not-saved' ? 'not-saved' : 'local'));
}
