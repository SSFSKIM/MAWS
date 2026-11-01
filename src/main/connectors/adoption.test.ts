// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, U7: Interfaces §B; D3, D23, D32): main's one-time
// adoption bound to the machine's `connectors.adoptGrant` through main's own route, over a scratch profile's grant
// directory and a fake Electron sealer (nothing here asks safeStorage or the Keychain). What it proves: a planted format
// 1 record is opened and handed over once, under main's own client, its input the registry's; a directory with no
// format 1 file asks the sealer nothing and the machine nothing; a machine that cannot take it leaves it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from '@shared/ipc/client';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { SEALED_FORMAT_V1, SEALED_FORMAT_V2, type ConnectorOAuthSealer } from '@shared/connectors/sealer';
import { validateCommandInput } from '@shared/ipc/validate';

vi.mock('electron', () => ({ app: {}, safeStorage: {} })); // legacy-custody's production sealer, never used here

const { adoptLegacyGrants } = await import('./adoption');

const A = '11111111-1111-4111-8111-111111111111';
const xor = (bytes: Buffer) => Buffer.from(bytes.map((byte) => byte ^ 0x5a));
const record = (connectionId: string) => ({
  connectionId,
  identity: { requestUrl: 'https://mcp.example.com/mcp', server: 'metrics', scope: 'user', configPath: '/home/o/.claude.json', entryPath: ['mcpServers', 'metrics'] },
  issuer: 'https://auth.example.com',
  resource: 'https://mcp.example.com',
  redirectUri: 'http://127.0.0.1:53100/callback',
  authorizationServer: { issuer: 'https://auth.example.com', authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token', response_types_supported: ['code'] },
  client: { client_id: 'client-1', redirect_uris: ['http://127.0.0.1:53100/callback'] },
  tokens: { accessToken: 'at', refreshToken: 'rt', tokenType: 'Bearer', obtainedAt: 1_700_000_000_000 },
  savedAt: 1_700_000_100_000,
});

// Electron's sealer as the adoption sees it: format 1, its text XORed
const sealer = {
  format: SEALED_FORMAT_V1,
  available: vi.fn(async () => true),
  seal: vi.fn(async (text: string) => xor(Buffer.from(text, 'utf8'))),
  open: vi.fn(async (sealed: Buffer) => ({ text: xor(sealed).toString('utf8'), reseal: false })),
} satisfies ConnectorOAuthSealer;

let root: string;
let dir: string;
let invoked: { name: CommandName; input: unknown; client: string }[];
let answer: CommandResult<'connectors.adoptGrant'>;
let logged: string[];

const plant = (id: string, format = SEALED_FORMAT_V1) => writeFileSync(join(dir, `${id}.sealed`), `${format}\n${xor(Buffer.from(JSON.stringify({ version: 1, ...record(id) }), 'utf8')).toString('base64')}\n`, { mode: 0o600 });
const adopt = () =>
  adoptLegacyGrants({
    directory: dir,
    sealer,
    invoke: (async (name: CommandName, input: unknown, context: HandlerContext) => {
      invoked.push({ name, input, client: context.client.id });
      return answer;
    }) as never,
    log: (line) => void logged.push(line),
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-o4-adoption-'));
  dir = join(root, 'connectors', 'oauth');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  invoked = [];
  answer = { ok: true, value: { adopted: true } };
  logged = [];
  vi.clearAllMocks();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('main’s adoption of the legacy grants', () => {
  it('hands a planted format 1 record to connectors.adoptGrant once, under main’s own client, as the registry takes it', async () => {
    plant(A);
    expect(await adopt()).toEqual({ adopted: 1, left: 0, stopped: false, retry: false });
    expect(invoked).toEqual([{ name: 'connectors.adoptGrant', input: { connectionId: A, record: record(A) }, client: 'main' }]);
    expect(validateCommandInput('connectors.adoptGrant', invoked[0]!.input).ok).toBe(true);
    expect(logged).toEqual(['[connectors] adopted 1 of 1 legacy grants']);
  });

  it('asks the sealer and the machine nothing when no format 1 file is there', async () => {
    plant(A, SEALED_FORMAT_V2);
    expect(await adopt()).toEqual({ adopted: 0, left: 0, stopped: false, retry: false });
    rmSync(dir, { recursive: true });
    expect(await adopt()).toEqual({ adopted: 0, left: 0, stopped: false, retry: false });
    expect(sealer.available).not.toHaveBeenCalled();
    expect(sealer.open).not.toHaveBeenCalled();
    expect(invoked).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('leaves a record the machine declines or cannot be asked to take, under its reason', async () => {
    plant(A);
    answer = { ok: true, value: { adopted: false, reason: 'present' } };
    expect(await adopt()).toEqual({ adopted: 0, left: 1, stopped: false, retry: false });
    answer = { ok: false, error: { code: 'host_unavailable', message: 'mawsd is not running' } };
    expect(await adopt()).toEqual({ adopted: 0, left: 1, stopped: false, retry: true });
    expect(logged).toEqual(['[connectors] adopted 0 of 1 legacy grants; left: present 1', '[connectors] adopted 0 of 1 legacy grants; left: host_unavailable 1']);
  });

  // P5 O4 (whole-branch review): a record the machine could not take yet asks for the pass again at the machine host's
  // next streaming (./index.ts); a decline, or a sealer that stopped the pass, settles it for the launch.
  it('says the pass is worth running again when the machine could not take a record yet, and only then', async () => {
    const B = '22222222-2222-4222-8222-222222222222';
    plant(A);
    plant(B);
    const notYet: CommandResult<'connectors.adoptGrant'>[] = [
      { ok: false, error: { code: 'unknown_command', message: 'unknown command: connectors.adoptGrant' } }, // a pre-O4 mawsd
      { ok: false, error: { code: 'host_unavailable', message: 'machine is restarting' } },
      { ok: false, error: { code: 'timeout', message: 'no answer within 10 s' } },
      { ok: true, value: { adopted: false, reason: 'unavailable' } }, // the machine's custody or connectors not up
    ];
    for (const given of notYet) {
      answer = given;
      expect(await adopt()).toEqual({ adopted: 0, left: 2, stopped: false, retry: true });
    }
    const settled: CommandResult<'connectors.adoptGrant'>[] = [
      { ok: true, value: { adopted: false, reason: 'stale' } },
      { ok: true, value: { adopted: false, reason: 'io' } },
      { ok: false, error: { code: 'internal', message: 'the handler threw' } },
    ];
    for (const given of settled) {
      answer = given;
      expect(await adopt()).toEqual({ adopted: 0, left: 2, stopped: false, retry: false });
    }
  });

  it('one record the machine could not take yet among adopted ones asks for the pass again', async () => {
    const B = '22222222-2222-4222-8222-222222222222';
    plant(A);
    plant(B);
    let calls = 0;
    const answers: CommandResult<'connectors.adoptGrant'>[] = [{ ok: true, value: { adopted: true } }, { ok: false, error: { code: 'unknown_command', message: 'unknown command' } }];
    const result = await adoptLegacyGrants({ directory: dir, sealer, invoke: (async () => answers[calls++]) as never, log: () => {} });
    expect(result).toEqual({ adopted: 1, left: 1, stopped: false, retry: true });
  });

  it('never asks for the pass again when the sealer stopped it', async () => {
    plant(A);
    sealer.available.mockResolvedValueOnce(false);
    expect(await adopt()).toEqual({ adopted: 0, left: 1, stopped: true, retry: false });
    sealer.seal.mockRejectedValueOnce(new Error('the Keychain denied'));
    expect(await adopt()).toEqual({ adopted: 0, left: 1, stopped: true, retry: false });
    expect(invoked).toEqual([]);
  });
});
