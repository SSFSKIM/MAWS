// The name a method's copy carries (DX7's `label`, 1 to 100 characters), for the owner to tell the methods apart in the
// key dialog: its kind and when it was added here.
import type { KeyMethod } from '../../key/unlock';

export function methodLabel(kind: KeyMethod, now = new Date()): string {
  const when = now.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${kind === 'passkey' ? 'Passkey' : 'Passphrase'}, added ${when}`;
}
