// The name a method's copy carries (DX7's `label`, 1 to 100 characters), for the owner to tell the methods apart in the
// key dialog: its kind and when it was added here, in the desk's display locale.
import { formatDateTime } from '@shared/app/date-format';
import type { KeyMethod } from '../../key/unlock';

export function methodLabel(kind: KeyMethod, now = new Date()): string {
  return `${kind === 'passkey' ? 'Passkey' : 'Passphrase'}, added ${formatDateTime(now.getTime())}`;
}
