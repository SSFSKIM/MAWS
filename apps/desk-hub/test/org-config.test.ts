// The org is made from deploy configuration (DX7), and the Registry that holds it is the one named by the configured
// org id. M5 saw a deploy that changed the org leave the new org's Registry holding the previous configuration's id and
// name: for about five minutes after a deploy, Durable Objects, new ones included, still run the previous version with
// its variables. A Registry whose stored org is not the one it is named for takes its identity from the configuration
// while it holds nothing built on the stored one; once it does, the stored org stands.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enroll } from './support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from './support/local';

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

const me = async () => ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { org: { id: string; name: string }; member: { id: string; role: string } });

describe("the org's identity", () => {
  it('follows the configuration in a Registry that holds nothing yet, keeping its admin', async () => {
    const before = await me();
    await hub.rewriteOrgRow({ id: 'previous-org', name: 'Previous org' });
    const after = await me();
    expect(after.org).toMatchObject({ id: ORG, name: 'Local org' });
    expect(after.member).toEqual(before.member);
  });

  it('stands once a machine was enrolled under it', async () => {
    await enroll(hub, ADMIN, 'kept');
    await hub.rewriteOrgRow({ id: 'previous-org', name: 'Previous org' });
    expect((await me()).org).toMatchObject({ id: 'previous-org' });
  });
});
