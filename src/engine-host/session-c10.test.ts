// C10's additions to the engine session (C10 execution document, Interfaces "X6 extensions" and "Catalogue cache"): a
// fork inherits the grant snapshot of the conversation it copies, the status reports trust, and the initialize
// response's model list reaches the catalogue cache.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { EngineSessionStatusSchema } from '@shared/engine/status';
import { loadJournal } from '../../test/support/fixtures';
import { listPermissionRules } from './controls';
import { handshakeResponder, INIT_RESPONSE, replayedSession, scriptedSession } from './conformance/session-harness';
import { FileSessionStateStore } from './store/file-session-state-store';
import { MemorySessionStateStore } from './store/memory-session-state-store';

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-c10-session-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

const SOURCE = 'app-source' as AppSessionId;
const FORK = 'app-fork' as AppSessionId;
const GRANT = 'Bash(touch granted.txt)';

describe('inherit grants on fork', () => {
  it("seeds an empty snapshot from the source's store file and re-applies it before ready (pass2/grant-reapply-resume seq 7)", async () => {
    const store = new FileSessionStateStore(userData);
    await store.saveGrants(SOURCE, { allow: [GRANT] });
    const fixture = loadJournal('pass2', 'grant-reapply-resume');
    const forked = await replayedSession('pass2', 'grant-reapply-resume', (row, { session, transport }) => {
      const frame = row.frame as { type: string; request?: { subtype: string } };
      if (frame.request?.subtype === 'apply_flag_settings') return; // the session's own re-application
      if (frame.request?.subtype === 'list_permission_rules') void listPermissionRules(session.control!, {});
      else transport.kill('SIGTERM'); // the first user frame: the handshake is what this pins
    }, {
      spec: { appSessionId: FORK, permissionMode: 'default', resume: { sessionId: 'f9bc61f8-7e18-466f-a860-8bb0781e2216' as never, fork: true }, inheritGrantsFrom: SOURCE },
      session: { store },
    });
    const outs = forked.journal.rows.filter((r) => r.direction === 'out').map((r) => r.frame as { type: string; request?: { subtype: string } });
    const apply = outs.find((f) => f.request?.subtype === 'apply_flag_settings');
    expect(apply?.request).toEqual((fixture.find((r) => r.seq === 7)!.frame as { request: unknown }).request);
    expect(forked.session.status().grants).toEqual([GRANT]);
    await store.loadGrants(FORK); // every save issued before this one has landed
    const file = JSON.parse(await readFile(join(userData, 'engine-host', 'state', `${FORK}.json`), 'utf8')) as { grants: unknown };
    expect(file.grants).toEqual({ allow: [GRANT] }); // the fork's own snapshot now, so its resume re-applies it by its own id
    expect(await store.loadGrants(SOURCE)).toEqual({ allow: [GRANT] }); // the source is untouched
  });

  it("keeps the session's own snapshot when it has one, and inherits nothing without inheritGrantsFrom", async () => {
    const store = new MemorySessionStateStore();
    await store.saveGrants(SOURCE, { allow: [GRANT] });
    await store.saveGrants(FORK, { allow: ['Bash(ls)'] });
    const own = scriptedSession({ spec: { appSessionId: FORK, resume: { sessionId: '44444444-4444-4444-8444-444444444444' as never, fork: true }, sessionId: null, inheritGrantsFrom: SOURCE }, session: { store } });
    await own.session.start();
    expect(own.transport.requestsOf('apply_flag_settings').map((f) => f.request)).toEqual([{ subtype: 'apply_flag_settings', settings: { permissions: { allow: ['Bash(ls)'] } } }]);
    const fresh = scriptedSession({ spec: { appSessionId: 'app-other' as AppSessionId }, session: { store } });
    await fresh.session.start();
    expect(fresh.transport.requestsOf('apply_flag_settings')).toEqual([]);
    expect(fresh.session.status().grants).toEqual([]);
  });

  it('re-applies an inherited snapshot on a launch that resumes nothing', async () => {
    const store = new MemorySessionStateStore();
    await store.saveGrants(SOURCE, { allow: [GRANT] });
    const { session, transport } = scriptedSession({ spec: { appSessionId: FORK, inheritGrantsFrom: SOURCE }, session: { store } });
    await session.start();
    expect(transport.requestsOf('apply_flag_settings').map((f) => f.request)).toEqual([{ subtype: 'apply_flag_settings', settings: { permissions: { allow: [GRANT] } } }]);
    expect(session.status()).toMatchObject({ process: 'ready', grants: [GRANT] });
  });
});

describe('state files written before the X6 extension', () => {
  it('still load: the stored launch spec reads inheritGrantsFrom as null and the queue and grants survive', async () => {
    const dir = join(userData, 'engine-host', 'state');
    await mkdir(dir, { recursive: true });
    const legacySpec = {
      appSessionId: 'app-legacy', cwd: '/tmp/x', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
      resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null,
    };
    await writeFile(join(dir, 'app-legacy.json'), JSON.stringify({ version: 1, queue: { entries: [], paused: true }, grants: { allow: [GRANT] }, launchSpec: legacySpec }));
    const warnings: string[] = [];
    const store = new FileSessionStateStore(userData, { warn: (m) => warnings.push(m) });
    const id = 'app-legacy' as AppSessionId;
    expect(await store.loadGrants(id)).toEqual({ allow: [GRANT] });
    expect(await store.loadQueue(id)).toEqual({ entries: [], paused: true, corrupt: null });
    expect(await store.loadLaunchSpec(id)).toEqual({ ...legacySpec, inheritGrantsFrom: null });
    expect(warnings).toEqual([]);
  });
});

describe('status reports trust', () => {
  it('attested iff the spec carried trust; recorded from the initialize response, null when absent', async () => {
    const attested = scriptedSession({
      spec: { trust: { accepted: true, directory: '/tmp/maws-session' } },
      responder: handshakeResponder({ initialize: () => ({ response: { ...INIT_RESPONSE, workspace_trust_recorded: true } }) }),
    });
    expect(attested.session.status().trust).toEqual({ attested: true, recorded: null }); // before initialize answers
    await attested.session.start();
    expect(EngineSessionStatusSchema.parse(attested.session.status()).trust).toEqual({ attested: true, recorded: true });
    expect(attested.transport.requestsOf('initialize')[0]!.request).toMatchObject({ workspaceTrust: { accepted: true, directory: '/tmp/maws-session' } });

    const home = scriptedSession({ spec: { trust: { accepted: true, directory: '/Users/x' } }, responder: handshakeResponder({ initialize: () => ({ response: { ...INIT_RESPONSE, workspace_trust_recorded: false } }) }) });
    await home.session.start();
    expect(home.session.status().trust).toEqual({ attested: true, recorded: false }); // the home directory's session-only answer

    const plain = scriptedSession();
    await plain.session.start();
    expect(plain.session.status().trust).toEqual({ attested: false, recorded: null });
  });
});

describe('catalogue from the initialize response', () => {
  it("hands the response's models to a 'models' listener", async () => {
    const { session } = scriptedSession();
    const seen: unknown[][] = [];
    session.on('models', (models) => seen.push(models));
    await session.start();
    expect(seen).toEqual([INIT_RESPONSE.models]);
  });
});
