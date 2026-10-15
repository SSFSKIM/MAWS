// A signed-in member, as `/api/me` answers, for the component suites.
import type { Me } from '../src/hub/me';

export const ME: Me = {
  org: { id: 'org', name: 'Org', created: '2026-10-15T00:00:00.000Z', key_check: null },
  member: { id: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', email: 'owner@example.com', role: 'admin', created: '2026-10-15T00:00:00.000Z' },
};
