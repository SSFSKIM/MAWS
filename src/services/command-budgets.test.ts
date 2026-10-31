// The spine's commands that run past a host request's 10 s (the panel's sweep#3): each keeps a budget that covers its
// own named waits, so main's `machine` binding does not answer `timeout` while mawsd goes on to finish it.
import { EventEmitter } from 'node:events';
import { join, relative } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createHostSupervisor, REQUEST_TIMEOUT_MS, type UtilityLink } from '@shared/host/host-supervisor';
import type { HostMessage } from '@shared/ipc/host-protocol';
import { REGISTRY } from '@shared/ipc/registry';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { COMMAND_BUDGETS_MS } from './command-budgets';
import { GIT_TIMEOUT_MS } from './git/runner';
import { GH_READ_TIMEOUT_MS } from './scm/pr-state';
import { COMMIT_TIMEOUT_MS, LOCAL_TIMEOUT_MS, SCM_ADMIT_MS } from './scm/service';
import { BRIDGE_SLACK_MS, LANE_A_TIMING } from './lane-a/driver';
import { CONFIGURE_WAIT_MS } from './settings/engine-configure';
import { EXIT_WAIT_MS, WATCHDOG_MS } from './sessions/context';
import { CLEAR_WAIT_MS, PAUSE_WAIT_MS } from './sessions/pause-take-over';
import { PAUSED_READY_MS } from './sessions/resume';
import { STOP_TIMEOUT_MS, TAKE_OVER_WAIT_MS } from './sessions/take-over';
import { CONNECTOR_OPERATION_DEADLINE_MS } from '@shared/artifacts/connectors';
import { DIRECT_OPERATION_DEADLINE_MS, DIRECT_RESOLVE_DEADLINE_MS } from './connectors/direct-route';
import { CONNECT_CALLBACK_TIMEOUT_MS } from './connectors/oauth-flow';
import { OAUTH_REQUEST_TIMEOUT_MS } from './connectors/oauth-http';
import { OAUTH_HOST_CLOSE_TIMEOUT_MS } from './connectors/oauth-provider';
import { OWNER_QUERY_DEADLINE_MS } from './connectors/owner';
import { DELIVERY_STATUS_DEADLINE_MS } from './delivery';
import { GONE_WAIT_MS, GWS_LOGIN_DEADLINE_MS, GWS_STATUS_TIMEOUT_MS, GWS_UPLOAD_TIMEOUT_MS, KILL_GRACE_MS } from './delivery/gws';

describe('the spine’s command budgets', () => {
  it('a take-over covers `claude stop` and the registry’s wait after it, and a pane’s pause and resume', () => {
    expect(COMMAND_BUDGETS_MS['session.takeOver']).toBeGreaterThan(STOP_TIMEOUT_MS + TAKE_OVER_WAIT_MS);
    expect(COMMAND_BUDGETS_MS['session.takeOver']).toBeGreaterThan(PAUSE_WAIT_MS + CONFIGURE_WAIT_MS + 2 * PAUSED_READY_MS + CLEAR_WAIT_MS);
  });

  it('an acquisition covers an exiting process’s wait, the configure gate and a launch to ready', () => {
    expect(COMMAND_BUDGETS_MS['session.acquire']).toBeGreaterThan(EXIT_WAIT_MS + CONFIGURE_WAIT_MS + WATCHDOG_MS);
  });

  it('the engine settings’ verdict, and lane A’s bridge commands, cover their own waits', () => {
    expect(COMMAND_BUDGETS_MS['settings.engineApplied']).toBeGreaterThan(CONFIGURE_WAIT_MS);
    for (const name of ['laneA.interrupt', 'laneA.command', 'laneA.btw', 'laneA.compact', 'laneA.stopAgent', 'laneA.tell', 'laneA.read', 'laneA.stopTask'] as const) {
      expect(COMMAND_BUDGETS_MS[name], name).toBeGreaterThan(LANE_A_TIMING.commandWaitMs + BRIDGE_SLACK_MS);
    }
    expect(COMMAND_BUDGETS_MS['laneA.answer']).toBeGreaterThan(LANE_A_TIMING.requestMs + LANE_A_TIMING.decisionMs);
    expect(COMMAND_BUDGETS_MS['laneA.model']).toBeGreaterThan(2 * (LANE_A_TIMING.commandWaitMs + BRIDGE_SLACK_MS));
    expect(COMMAND_BUDGETS_MS['laneA.media']).toBeGreaterThan(4 * (LANE_A_TIMING.commandWaitMs + BRIDGE_SLACK_MS) + GIT_TIMEOUT_MS + 1_000 + 3_000);
  });

  it('names only machine-owned commands, each budgeted past the default it replaces', () => {
    for (const [name, budget] of Object.entries(COMMAND_BUDGETS_MS)) {
      expect(REGISTRY.commands[name as keyof typeof REGISTRY.commands]?.owner, name).toBe('machine');
      expect(budget, name).toBeGreaterThan(REQUEST_TIMEOUT_MS);
    }
  });
});

// P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §H; D11): every moved git and scm
// command, and the upload, carries the sum of its own chain, which this pins term by term against the waits it names
const MARGIN = 10_000;
const GIT = GIT_TIMEOUT_MS;
const GH = GH_READ_TIMEOUT_MS;
const STATUS = 3 * GIT;
const EXPECTED: Record<string, number> = {
  'git.status': STATUS + MARGIN,
  'git.watch': STATUS + MARGIN,
  'git.branches': GIT + MARGIN,
  'git.diff': STATUS + GIT + MARGIN,
  'git.log': GIT + MARGIN,
  'git.lsFiles': GIT + MARGIN,
  'scm.status': GH + 3 * GIT + MARGIN,
  'scm.stage': SCM_ADMIT_MS + GIT + STATUS + LOCAL_TIMEOUT_MS + STATUS + MARGIN,
  'scm.unstage': SCM_ADMIT_MS + GIT + STATUS + LOCAL_TIMEOUT_MS + STATUS + MARGIN,
  'scm.discard': SCM_ADMIT_MS + GIT + STATUS + 2 * LOCAL_TIMEOUT_MS + STATUS + MARGIN,
  'scm.commit': SCM_ADMIT_MS + GIT + STATUS + COMMIT_TIMEOUT_MS + STATUS + GIT + MARGIN,
  'scm.push.plan': GIT + STATUS + 6 * GIT + MARGIN,
  'scm.pr.plan': GIT + STATUS + 2 * GH + 5 * GIT + MARGIN,
  'scm.push': SCM_ADMIT_MS + GIT + STATUS + GIT + MARGIN,
  'scm.pr.create': SCM_ADMIT_MS + GIT + STATUS + GIT + MARGIN,
  'scm.remote.cancel': GIT + MARGIN,
  'scm.remote.last': GIT + MARGIN,
  'scm.pr.state': GH + STATUS + 2 * GIT + 2 * GH + MARGIN,
  'files.upload': GIT + MARGIN,
};

describe('the checkouts’ command budgets (P5 O3-E)', () => {
  it('names every git.* and scm.* command the move retags, and files.upload, each the sum of its chain', () => {
    const moved = Object.keys(REGISTRY.commands).filter((name) => /^(git|scm)\./.test(name) && !name.startsWith('git.worktree.') && name !== 'git.unwatch' /* no git call */);
    expect(Object.keys(EXPECTED).sort()).toEqual([...moved, 'files.upload'].sort());
    for (const [name, budget] of Object.entries(EXPECTED)) expect(COMMAND_BUDGETS_MS[name as CommandName], name).toBe(budget);
    expect(COMMAND_BUDGETS_MS['git.unwatch']).toBeUndefined();
    for (const name of ['files.list', 'files.read', 'files.write', 'files.watch'] as const) expect(COMMAND_BUDGETS_MS[name], name).toBeUndefined(); // the default
  });

  // Over main's `machine` host as the daemon shape builds it (the table as its spec's budgets): a commit whose hooks take
  // 20 s answers its result, once, where the default deadline would have answered `timeout` while mawsd went on
  it('answers a commit that ends after 20 s within its own deadline, exactly once', async () => {
    const posted: HostMessage[] = [];
    const listeners: ((event: { data: unknown }) => void)[] = [];
    const child = Object.assign(new EventEmitter(), { pid: 4242, kill: () => true });
    const link: UtilityLink = {
      child,
      port: { postMessage: (message) => void posted.push(message), on: (_event, listener) => void listeners.push(listener), start: () => {}, close: () => {} },
      postDoc: () => {},
    };
    const hosts = createHostSupervisor({
      hosts: { machine: { modulePath: 'mawsd.js', serviceName: 'mawsd', requestBudgetsMs: COMMAND_BUDGETS_MS } },
      emit: () => true,
      launchUtility: () => link,
      userData: () => '/nowhere',
      packaged: () => false,
    });
    void hosts.start();
    child.emit('spawn');
    expect(hosts.snapshot('machine').state).toBe('ready');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const answers: CommandResult<CommandName>[] = [];
      void hosts.dispatch('machine', 'scm.commit', { appSessionId: 'a', message: 'x', noVerify: false }).then((answer) => void answers.push(answer));
      const unbudgeted = hosts.dispatch('machine', 'git.unwatch', { directory: '/r' }); // no budget of its own: the default
      const request = posted.find((message): message is Extract<HostMessage, { t: 'req' }> => message.t === 'req' && message.name === 'scm.commit')!;
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10_000);
      await expect(unbudgeted).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
      expect(answers).toEqual([]);
      const after = { repoRoot: '/r', gitDir: '/r/.git', commonDir: '/r/.git', isWorktree: false, branch: 'main', head: 'h', upstream: null, remoteUrl: null, ahead: 0, behind: 0, dirty: false, files: [], stashCount: 0, checkedAt: '2026-10-30T00:00:00.000Z' };
      for (const listener of listeners) listener({ data: { t: 'res', id: request.id, ok: true, value: { ok: true, status: after, output: '', commit: { sha: 'c'.repeat(40), subject: 'x' } } } });
      await vi.advanceTimersByTimeAsync(COMMAND_BUDGETS_MS['scm.commit']!);
      expect(answers).toEqual([{ ok: true, value: expect.objectContaining({ ok: true, commit: { sha: 'c'.repeat(40), subject: 'x' } }) }]);
    } finally {
      vi.useRealTimers();
      void hosts.stop();
    }
  });
});

// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §H): the connectors' and delivery's commands
// whose chains run past the default, pinned term by term against the waits they name
const HOST = REQUEST_TIMEOUT_MS;
const GWS_RUN = (timeoutMs: number) => timeoutMs + KILL_GRACE_MS + GONE_WAIT_MS;
const CREDENTIAL = OAUTH_REQUEST_TIMEOUT_MS + OAUTH_HOST_CLOSE_TIMEOUT_MS;
const DIRECT = DIRECT_RESOLVE_DEADLINE_MS + CREDENTIAL + DIRECT_OPERATION_DEADLINE_MS;
const CALL = HOST + Math.max(5 * HOST + CONNECTOR_OPERATION_DEADLINE_MS + HOST, DIRECT);
const NOTION_FIND = 3 * HOST + DIRECT_RESOLVE_DEADLINE_MS;
const O4_EXPECTED: Record<string, number> = {
  'connectors.call': CALL + MARGIN,
  'connectors.refresh': CALL + MARGIN,
  'connectors.servers': OWNER_QUERY_DEADLINE_MS + MARGIN,
  'delivery.status': Math.max(GWS_RUN(GWS_STATUS_TIMEOUT_MS), DELIVERY_STATUS_DEADLINE_MS) + MARGIN,
  'delivery.connect': Math.max(GWS_RUN(GWS_STATUS_TIMEOUT_MS) + GWS_RUN(GWS_LOGIN_DEADLINE_MS), NOTION_FIND + 3 * OAUTH_REQUEST_TIMEOUT_MS + CONNECT_CALLBACK_TIMEOUT_MS + OAUTH_REQUEST_TIMEOUT_MS) + MARGIN,
  'delivery.deliver': HOST + Math.max(GWS_RUN(GWS_STATUS_TIMEOUT_MS) + GWS_RUN(GWS_UPLOAD_TIMEOUT_MS), NOTION_FIND + DIRECT) + MARGIN,
};

describe('the connectors’ and delivery’s command budgets (P5 O4)', () => {
  it('names the six whose chains pass the default, each the sum of its chain', () => {
    for (const [name, budget] of Object.entries(O4_EXPECTED)) expect(COMMAND_BUDGETS_MS[name as CommandName], name).toBe(budget);
    const named = Object.keys(COMMAND_BUDGETS_MS).filter((name) => /^(connectors|delivery)\./.test(name));
    expect(named.sort()).toEqual(Object.keys(O4_EXPECTED).sort());
  });

  it('answers within the default for what acknowledges at once or reads in one step', () => {
    for (const name of ['connectors.open', 'connectors.connect', 'connectors.signIn', 'delivery.cancel', 'delivery.receipts', 'artifacts.grantConnectorTool'] as const) {
      expect(COMMAND_BUDGETS_MS[name], name).toBeUndefined();
    }
  });
});

// P5 O4 M3 (Interfaces §H): one cwd's engine view is three rounds of host reads; the library's reads are one host read
// and a file or the client's answer
describe('the catalog’s and the library’s command budgets (P5 O4 M3)', () => {
  it('names catalog.engine alone, its three rounds of host reads', () => {
    expect(COMMAND_BUDGETS_MS['catalog.engine']).toBe(3 * HOST + MARGIN);
    expect(Object.keys(COMMAND_BUDGETS_MS).filter((name) => /^(catalog|library)\./.test(name))).toEqual(['catalog.engine']);
  });
});

// P5 O4 M2 (acceptance 9): the table loads with main's import of the services entry and in every chunk that names it,
// so of the connectors and delivery it reads their deadlines alone, never their services (the custody's backup
// exclusion among them, whose JXA text the bundle guard reads as a dynamic import)
describe('what the budgets load of the connectors and delivery', () => {
  it('is their deadline modules alone', () => {
    const root = join(__dirname, '..', '..');
    const { metafile } = buildSync({ entryPoints: [join(__dirname, 'command-budgets.ts')], bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external', tsconfig: join(root, 'tsconfig.node.json'), logLevel: 'silent' });
    const loaded = Object.keys(metafile.inputs).map((path) => relative(root, join(root, path)));
    expect(loaded.filter((path) => /^src\/services\/(connectors|delivery)\//.test(path)).sort()).toEqual(['src/services/connectors/deadlines.ts', 'src/services/delivery/deadlines.ts']);
    expect(loaded.filter((path) => path.includes('backup-exclusion'))).toEqual([]);
    expect(loaded.filter((path) => /^src\/services\/(catalog|library)\//.test(path))).toEqual([]); // P5 O4 M3
  });
});
