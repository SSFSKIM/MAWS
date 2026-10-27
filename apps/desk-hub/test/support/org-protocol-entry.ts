// A Worker that replays the protocol package's vectors as the hub's bundle reaches the package (through the workspace,
// `org-protocol/vectors`), and checks each dual-coded event's v1 mac with DX1 (test/protocol/org-protocol.test.ts).
import { replayVectors, VECTORS } from 'org-protocol/vectors';
import { base64urlDecode } from '../../src/protocol/base64url';
import { importOrgKey, verify } from '../../src/protocol/codes';

export default {
  async fetch(): Promise<Response> {
    const dual = await Promise.all(VECTORS.dual.map(async (d) => verify(await importOrgKey(base64urlDecode(d.orgKey)), 'log', d.project, d.event)));
    return Response.json({ cases: VECTORS.cases.length, failures: await replayVectors(VECTORS), dual });
  },
};
