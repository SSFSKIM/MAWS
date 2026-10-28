// The protocol package's vectors in the web app's runtime (O13 §A: "replayed … by desk-web's test/vectors.ts"): the
// whole set through the package's replay, as every consumer runs it, and the pairing vector through the very calls the
// phone's registration makes — the code decoded, the entry's MAC under its `k`, the fingerprint the panel shows, and a
// swapped passkey under the same channel key showing another.
import { base64urlDecode, decodePairingCode, pairingFingerprint, pairingMac, verifyPairingMac, type Device, type MemberId } from 'org-protocol';
import { replayVectors, VECTORS } from 'org-protocol/vectors';
import { describe, expect, it } from 'vitest';
import { PAIRING_VECTOR } from '../../test/vectors';

describe("the protocol package's vectors in desk-web", () => {
  it('replay with no failure', async () => {
    expect(await replayVectors(VECTORS)).toEqual([]);
  });

  it("give the pairing code, the entry's MAC and its fingerprint as the phone computes them", async () => {
    const code = decodePairingCode(PAIRING_VECTOR.code);
    expect(code).toEqual(PAIRING_VECTOR.decoded);
    const k = base64urlDecode(code!.k);
    const { org, member, device } = PAIRING_VECTOR.fields as { org: string; member: MemberId; device: Omit<Device, 'endorsement'> };
    expect(await pairingMac(k, { org, member, device })).toBe(PAIRING_VECTOR.mac);
    expect(await pairingFingerprint(org, member, device)).toBe(PAIRING_VECTOR.fingerprint);

    const swapped = PAIRING_VECTOR.swapped.fields.device as Omit<Device, 'endorsement'>;
    expect(swapped.channelPub).toBe(device.channelPub);
    expect(await verifyPairingMac(k, { org, member, device: swapped }, PAIRING_VECTOR.mac)).toBe(false);
    expect(await pairingFingerprint(org, member, swapped)).toBe(PAIRING_VECTOR.swapped.fingerprint);
    expect(PAIRING_VECTOR.swapped.fingerprint).not.toBe(PAIRING_VECTOR.fingerprint);
  });
});
