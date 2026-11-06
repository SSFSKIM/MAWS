import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelAnswer, OrgStatus } from '@shared/ipc/schema/org';
import type { OrgSessionService } from './org-session';
import { CHANNEL_FIXTURE_ENV, installChannelFixture, type ChannelFixtureInstall } from './channel-fixture';
import { registerOrgHandlers } from './register';

const PROJECT = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const STATUS: OrgStatus = {
  state: 'registered',
  org: 'northwind',
  hub: 'https://desk.northwind.example',
  member: { id: 'a1', email: 'ana@northwind.example' },
  device: 'dev-ana-mac-0000000000',
  session: 'signed-in',
  hubAccess: 'unreachable',
  head: { version: 7, issued: '2026-10-28T09:00:00.000Z' },
  problem: null,
  signer: null,
  pairing: null,
};
const ANSWER: ChannelAnswer = {
  ok: true,
  rev: 4,
  events: [{ offset: 3, writer: 'hub/a1', seq: 1, event: { kind: 'human', member: 'a1', to: '*', text: 'hello', ts: '2026-10-28T09:00:00.000Z' }, label: 'verified', author: { id: 'a1', email: 'ana@northwind.example', name: 'Ana' } }],
  sessions: [],
  pending: [{ nonce: 'n1', text: 'refused', to: '*', state: { refused: 'not-reachable' } }],
  unverified: 2,
  asOf: '2026-10-28T08:59:00.000Z',
  live: false,
};

let scratch: string | null = null;
afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

function fixtureFile(body: unknown): string {
  scratch ??= mkdtempSync(join(tmpdir(), 'maws-channel-fixture-'));
  const path = join(scratch, 'channel.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}

type Handler = (input: unknown) => unknown;
function deps(env: Record<string, string>, packaged = false, unpublish = () => {}): ChannelFixtureInstall & { handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  return {
    env,
    packaged,
    intercept: (name, handler) => {
      handlers.set(name, handler as Handler);
      return () => void handlers.delete(name);
    },
    unpublish,
    handlers,
  };
}

describe("the project channel's e2e fixture in main", () => {
  it('installs only under MAWS_E2E=1, unpackaged, with an absolute fixture path', () => {
    const path = fixtureFile({ status: STATUS, project: PROJECT, answer: ANSWER });
    for (const [env, packaged] of [
      [{ [CHANNEL_FIXTURE_ENV]: path }, false],
      [{ MAWS_E2E: '1' }, false],
      [{ MAWS_E2E: '1', [CHANNEL_FIXTURE_ENV]: path }, true],
      [{ MAWS_E2E: '1', [CHANNEL_FIXTURE_ENV]: 'channel.json' }, false],
    ] as const) {
      const d = deps(env, packaged);
      expect(installChannelFixture(d)).toBeNull();
      expect(d.handlers.size).toBe(0);
    }
  });

  it("answers org.status and the seeded project's org.channel.open from the file, another project unknown, and sends nothing", async () => {
    const d = deps({ MAWS_E2E: '1', [CHANNEL_FIXTURE_ENV]: fixtureFile({ status: STATUS, project: PROJECT, answer: ANSWER }) });
    const stop = installChannelFixture(d);
    expect(stop).not.toBeNull();
    expect([...d.handlers.keys()].sort()).toEqual(['org.channel.close', 'org.channel.open', 'org.channel.send', 'org.status']);
    const ask = (name: string, input?: unknown) => Promise.resolve(d.handlers.get(name)!(input));
    expect(await ask('org.status')).toEqual(STATUS);
    expect(await ask('org.channel.open', { project: PROJECT })).toEqual(ANSWER);
    expect(await ask('org.channel.open', { project: '2f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0' })).toEqual({ ok: false, reason: 'unknown-project', rev: ANSWER.rev });
    expect(await ask('org.channel.close', { project: PROJECT })).toBeUndefined();
    expect(await ask('org.channel.send', { project: PROJECT, text: 'hi' })).toMatchObject({ ok: false, reason: 'no-hub' });
    stop!();
    expect(d.handlers.size).toBe(0);
  });

  it("stops the production session's org.changed, so a status it publishes late never replaces the seeded one", () => {
    let publish: (status: OrgStatus) => void = () => {};
    const service = {
      onStatus(listener: (status: OrgStatus) => void) {
        publish = listener;
        return () => void (publish = () => {});
      },
      onChannel: () => () => {},
    } as unknown as OrgSessionService;
    const emitted: OrgStatus[] = [];
    const unpublish = registerOrgHandlers({ register: () => {}, emit: (_name, status) => void emitted.push(status), emitChannel: () => {}, service, development: null });
    publish({ state: 'none' });
    expect(emitted).toEqual([{ state: 'none' }]);

    expect(installChannelFixture(deps({ MAWS_E2E: '1', [CHANNEL_FIXTURE_ENV]: fixtureFile({ status: STATUS, project: PROJECT, answer: ANSWER }) }, false, unpublish))).not.toBeNull();
    publish({ state: 'none' });
    expect(emitted).toEqual([{ state: 'none' }]);
  });

  it('refuses a file the schemas reject, naming its path', () => {
    const path = fixtureFile({ status: STATUS, project: PROJECT, answer: { ...ANSWER, token: 'never' } });
    expect(() => installChannelFixture(deps({ MAWS_E2E: '1', [CHANNEL_FIXTURE_ENV]: path }))).toThrow(path);
  });

  // As the Org page's fixture: a build of main without the harness carries none of it (app.ts's guard).
  const OUT = resolve(__dirname, '../../../out');
  const plainMain = existsSync(join(OUT, 'main/index.js')) && !existsSync(join(OUT, 'renderer/harness.html'));
  it.skipIf(!plainMain)('is absent from a build of main without the harness', () => {
    const chunks = readdirSync(join(OUT, 'main'), { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.js'));
    expect(chunks.filter((name) => readFileSync(join(OUT, 'main', name), 'utf8').includes(CHANNEL_FIXTURE_ENV))).toEqual([]);
  });
});
