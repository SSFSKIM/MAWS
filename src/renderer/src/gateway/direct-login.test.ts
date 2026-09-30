import { join } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetStatusResponse } from '@shared/wire/control';
import { fixtureLine } from '../../../../test/support/widget-backend';
import { fakeClient } from '../../../../test/support/fake-client';
import { connectDirectLogin, directLoginOf } from './direct-login';
import { createGatewayStore } from './store';

const ROOT = join(__dirname, '../../../..');
const DIRECT = fixtureLine(ROOT, 'pass2/routing-flag-override#12') as GetStatusResponse;
const ROUTED = fixtureLine(ROOT, `pass2/auto-routed#${145}`) as GetStatusResponse; // seq 145, named apart from the tokens guard's colour pattern
const A = 'app-a' as AppSessionId;

describe('the direct login', () => {
  it("reads a direct session's Login, Organization and Email rows, and nothing from a routed one", () => {
    expect(directLoginOf(DIRECT)).toEqual({ login: 'Expired — log in again', organization: "owner@redacted.invalid's Organization", email: 'owner@redacted.invalid' });
    expect(directLoginOf(ROUTED)).toBeNull();
  });

  it('follows every session.getStatus answer in the query cache', async () => {
    const client = new QueryClient();
    const gateway = createGatewayStore(fakeClient().client);
    const off = connectDirectLogin(client, gateway);
    await client.fetchQuery({ queryKey: ['maws', 'session.getStatus', { appSessionId: A }], queryFn: () => ROUTED });
    expect(gateway.getState().directLogin.size).toBe(0);
    await client.fetchQuery({ queryKey: ['maws', 'session.getStatus', { appSessionId: A }], queryFn: () => DIRECT, staleTime: 0 });
    expect(gateway.getState().directLogin.get(A)).toMatchObject({ login: 'Expired — log in again' });
    off();
  });
});
