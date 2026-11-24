// The person's own Unpair (§P; T10, T19). mawsd is told only over a proven connection; then the connection ends and
// every key under the page's prefix is forgotten, whatever mawsd answered. What became of the pairing is kept apart,
// since each asks something different of the person: `revoked`, mawsd refused it and saved that; `not-saved`, mawsd
// refuses it now but could not save the change, so a restart before a save pairs the browser again; `local`, this
// browser forgot it and mawsd was never told (no proven connection, or no answer), so mawsd still lists it.
import type { Done } from './api';

// `refused`: the connection's opening was refused, or another tab of this browser unpaired it
export type Unpaired = 'refused' | 'revoked' | 'not-saved' | 'local';

export async function unpairThisBrowser(deps: { unpair(): Promise<Done>; close(): void; forget(): void }): Promise<Unpaired> {
  const done = await deps.unpair();
  deps.close();
  deps.forget();
  if (done.ok) return 'revoked';
  return done.why === 'not-saved' ? 'not-saved' : 'local';
}
