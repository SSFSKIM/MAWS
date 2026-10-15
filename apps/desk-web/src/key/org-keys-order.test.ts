// DX7's check order, as the double serves it for the web's suites: in an org that has a key, a change to
// `/api/org/keys` without the key's `auth` — missing or malformed — is `403 not-key-holder` before any shape check, so a
// caller without the key learns nothing about the body; `400 bad-shape` is left for a body whose `auth` is correct, or
// for the org's first key.
import { expect, it } from 'vitest';
import { base64urlEncode } from 'desk-hub/protocol';
import { ME } from '../../test/me';
import { OrgKeysDouble } from '../../test/double/org-keys';

const b64 = (n: number, fill: number) => base64urlEncode(new Uint8Array(n).fill(fill));
const copy = (auth: unknown, over: Record<string, unknown> = {}) => ({ method: 'passphrase', label: 'Mac', kdf: { alg: 'argon2id' }, iv: b64(12, 1), wrapped: b64(48, 2), check: b64(32, 3), auth, ...over });

it('refuses a change without the key as not-key-holder before reading its shape, and keeps bad-shape for the holder and the first key', async () => {
  const hub = new OrgKeysDouble();
  expect((await hub.add(ME.member, copy(b64(32, 9), { label: '' }))).status).toBe(400); // the first key: shape first
  expect((await hub.add(ME.member, copy(b64(32, 9)))).status).toBe(201);
  for (const auth of [undefined, 'not base64url', b64(16, 9)]) {
    expect(await hub.add(ME.member, copy(auth, { label: '' }))).toMatchObject({ status: 403, body: { error: 'not-key-holder' } });
    expect(await hub.add(ME.member, { auth })).toMatchObject({ status: 403, body: { error: 'not-key-holder' } });
  }
  expect(await hub.add(ME.member, copy(b64(32, 9), { label: '' }))).toMatchObject({ status: 400, body: { error: 'bad-shape' } });
});
