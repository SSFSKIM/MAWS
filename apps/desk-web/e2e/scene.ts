// A project as two machines' daemons would leave it on the hub: four sessions joined (one since retired), their
// in-charge lines, a message to the human, and each machine's and session's presence.
import type { ProjectSummary } from 'desk-hub/protocol';
import type { HubDouble } from '../test/double/hub-double';
import { VECTOR_PROJECT } from '../test/vectors';

export const PROJECT = VECTOR_PROJECT;
export const S = {
  asks: '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', // maws-45 on mini, waiting on the owner
  works: '9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a', // maws-fe on SK.local, busy
  rests: '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a', // cua_repl on mini, idle
  gone: 'e0ad139c-18bc-45bd-9489-be8653145f80', // doperpowers-1e on SK.local, retired
};

export const summary = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({ id: PROJECT, name: 'MAWS', kind: 'hub', machines: 2, machines_online: 2, working: 1, waiting: 1, live: 3, ...over });

const joined = (session: string, alias: string, machine: string) => ({
  writer: `${machine}/${session}`,
  kind: 'joined',
  session,
  alias,
  name_source: 'user',
  machine,
  cwd: `/Users/new/Developer/GitHub/MAWS`,
  worktree: '',
  role: '',
  seat: '',
  by: '',
});
const charge = (session: string, machine: string, text: string) => ({ writer: `${machine}/${session}`, kind: 'in-charge', session, text, source: 'set' });

export async function stageProject(hub: HubDouble): Promise<void> {
  hub.setGrid([summary(), { id: 'arkho', name: 'arkho', kind: 'hub', machines: 1, machines_online: 0, working: 0, waiting: 0, live: 1 }]);
  await hub.append(PROJECT, joined(S.gone, 'doperpowers-1e', 'SK.local'));
  await hub.append(PROJECT, joined(S.rests, 'cua_repl', 'mini'));
  await hub.append(PROJECT, charge(S.rests, 'mini', 'cua_repl browser and GUI tool'));
  await hub.append(PROJECT, joined(S.works, 'maws-fe', 'SK.local'));
  await hub.append(PROJECT, charge(S.works, 'SK.local', 'GUI AI agent workspace: main app architect'));
  await hub.append(PROJECT, joined(S.asks, 'maws-45', 'mini'));
  await hub.append(PROJECT, charge(S.asks, 'mini', 'owner artifacts page'));
  await hub.append(PROJECT, { writer: `SK.local/${S.gone}`, kind: 'retired', session: S.gone, by: 'human', reason: 'retire' });
  await hub.append(PROJECT, { writer: `mini/${S.asks}`, kind: 'message', from: 'maws-45', to: 'host', text: 'the migration is merged', src: 'r1:0' });
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
  ]);
  const presence = (machine: string, session: string, status: string) =>
    hub.sendSession(PROJECT, { project: PROJECT, machine, session, kind: 'presence', sub: null, n: null, body: { record: { status }, bridge: true } });
  presence('mini', S.asks, 'waiting');
  presence('SK.local', S.works, 'busy');
  presence('mini', S.rests, 'idle');
}
