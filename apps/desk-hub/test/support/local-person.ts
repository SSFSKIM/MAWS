// The deployment's commands against the local hub (O11 M8): a `Person` (deploy/hub.ts) admitted by the stand-in's test
// identity in place of an Access token, and an admin device's keys file as the staging test device keeps one.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, importSigningKey } from 'org-protocol';
import { Person } from '../../deploy/hub.ts';
import type { AdminDevice } from '../../deploy/org-admin.ts';
import { ADMIN, credentials, type LocalHub } from './local';

export class LocalPerson extends Person {
  constructor(
    hub: LocalHub,
    private readonly who: string = ADMIN,
    gate?: () => void,
  ) {
    super(hub.url, 'unused', gate);
  }

  override get headers(): Record<string, string> {
    return credentials(this.who);
  }
}

/** A fresh admin device written to a keys file (0600) as `{keys: {"<id>.channel", "<id>.stepUp", "recovery"}}`. */
export async function adminKeysFile(id = 'a1'): Promise<{ file: string; device: AdminDevice }> {
  const made = { channel: await generateSigningKey(true), stepUp: await generateSigningKey(true), recovery: await generateSigningKey(true) };
  const jwk = async (key: CryptoKey) => (await crypto.subtle.exportKey('jwk', key)) as JsonWebKey;
  const keys = { [`${id}.channel`]: await jwk(made.channel.privateKey), [`${id}.stepUp`]: await jwk(made.stepUp.privateKey), recovery: await jwk(made.recovery.privateKey) };
  const file = join(mkdtempSync(join(tmpdir(), 'm8-device-')), 'keys.json');
  writeFileSync(file, JSON.stringify({ keys }), { mode: 0o600 });
  const device = { id, channel: await importSigningKey(keys[`${id}.channel`]), stepUp: await importSigningKey(keys[`${id}.stepUp`]), recovery: await importSigningKey(keys.recovery) };
  return { file, device };
}
