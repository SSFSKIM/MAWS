// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §G; D14, D15, D29, D38): main's
// `delivery.send` over a scripted machine: the export service writes a real file of its own, `delivery.status` and
// `delivery.deliver` are the machine's (main's own route, answered here), and the router's seam before
// `delivery.cancel` is driven as the router drives it. What it proves: the machine's status is read before anything is
// exported and a state that cannot send is refused with no export (D38); Notion takes the Notion dialect and Markdown
// alone; the export's path, revision and the artifact's title are handed to `delivery.deliver` and its answer is the
// send's; a cancel during the export phase is main's, answered `cancelled`, the export let finish and its file removed,
// nothing handed off; once handed off, the cancel is the machine's.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientId, HandlerContext } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { DeliveryStatus } from '@shared/ipc/schema/delivery';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import type { BeforeHook } from '../ipc/router';
import { registerDeliverySend, type DeliverySendDeps } from './send';

const ART = '11111111-1111-4111-8111-111111111111';
const RUN = () => crypto.randomUUID();
const CLIENT = { id: 'page:1.1' as ClientId, onGone: () => () => {} }; // the page asking
const KEY = '77777777-7777-4777-8777-777777777777'; // a located source's handle
const RECEIPT = { artifactId: ART, target: 'drive', at: 1, name: 'Quarterly memo.docx', url: null, format: 'docx', revision: 7, destination: { kind: 'default' } } as const;

let dir: string;
let handler: ((input: unknown, ctx: unknown) => unknown) | null;
let hook: BeforeHook | null;
let hookedNames: readonly CommandName[];
let exported: { input: Record<string, unknown>; options?: { dialect?: string }; path: string }[];
let exporting: Promise<void> | null; // an export held until the test lets it finish
let invoked: { name: string; input: Record<string, unknown>; client: string }[];
let status: DeliveryStatus;
let delivered: CommandResult<'delivery.deliver'>;
let artifact: { title: string } | null;
let dispose: () => void;

function start(overrides: Partial<DeliverySendDeps> = {}) {
  dispose = registerDeliverySend({
    register: ((name: string, given: (input: unknown, ctx: unknown) => unknown) => {
      expect(name).toBe('delivery.send');
      handler = given;
    }) as never,
    before: (names, given) => {
      hookedNames = names;
      hook = given;
      return () => {
        hook = null;
      };
    },
    exportArtifact: async (input, options) => {
      const path = join(dir, `7-${input.format}-${crypto.randomUUID()}.${input.format}`);
      await exporting;
      writeFileSync(path, options?.dialect === 'notion' ? '# Notion body' : 'bytes');
      exported.push({ input: input as never, ...(options && { options }), path });
      return { path, revision: 7, exportId: crypto.randomUUID() };
    },
    call: (async () => ({ ok: true, value: { artifact } })) as never,
    invoke: (async (name: CommandName, input: unknown, context: HandlerContext) => {
      invoked.push({ name, input: input as Record<string, unknown>, client: context.client.id });
      expect(validateCommandInput(name, input).ok, `${name} input`).toBe(true);
      if (name === 'delivery.status') return { ok: true, value: status };
      if (name === 'delivery.deliver') return delivered;
      throw new Error(`unexpected ${name}`);
    }) as never,
    log: () => {},
    ...overrides,
  });
}

// The send as a page asks it: the input validated, the output checked
async function send(input: Record<string, unknown>): Promise<unknown> {
  const checked = validateCommandInput('delivery.send', input);
  if (!checked.ok) throw new Error(`invalid input: ${JSON.stringify(checked.error)}`);
  const value = await handler!(checked.value, { client: CLIENT });
  const output = validateCommandOutput('delivery.send', value);
  if (!output.ok) throw new Error(`invalid output: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value;
}
// A page's cancel as the router's seam sees it: an answer, or undefined to go on to the machine
const cancel = (runId: string) => hook!('delivery.cancel', { runId } satisfies CommandInput<'delivery.cancel'>, CLIENT);
const drive = (runId = RUN(), extra: Record<string, unknown> = {}) => ({ runId, target: 'drive', artifactId: ART, format: 'docx', destination: { kind: 'default' }, ...extra });
const notion = (runId = RUN(), extra: Record<string, unknown> = {}) => ({ runId, target: 'notion', artifactId: ART, format: 'md', destination: { kind: 'default' }, ...extra });
const names = () => invoked.map((entry) => entry.name);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-o4-send-'));
  handler = null;
  hook = null;
  exported = [];
  exporting = null;
  invoked = [];
  artifact = { title: 'Quarterly memo' };
  status = { target: 'drive', state: 'ready', user: 'owner@example.com' };
  delivered = { ok: true, value: { ok: true, receipt: RECEIPT } };
  start();
});
afterEach(() => {
  dispose();
  rmSync(dir, { recursive: true, force: true });
});

describe('main’s delivery.send', () => {
  it('reads the machine’s status, exports in the owner’s format, hands the export to delivery.deliver and answers its answer', async () => {
    const runId = RUN();
    expect(await send(drive(runId, { versionId: 3, board: 'main' }))).toEqual({ ok: true, receipt: RECEIPT });
    expect(exported).toEqual([{ input: { artifactId: ART, format: 'docx', ownFile: true, versionId: 3, board: 'main' }, path: expect.any(String) }]);
    expect(invoked).toEqual([
      { name: 'delivery.status', input: { target: 'drive', artifactId: ART }, client: 'main' },
      { name: 'delivery.deliver', input: { ...drive(runId, { versionId: 3, board: 'main' }), exportPath: exported[0]!.path, revision: 7, title: 'Quarterly memo' }, client: 'main' },
    ]);
    expect(existsSync(exported[0]!.path)).toBe(true); // the machine removes what it admitted
  });

  it('exports Notion’s dialect for Notion, and refuses Notion any format but Markdown before reading or exporting anything', async () => {
    status = { target: 'notion', state: 'ready', connection: 'connected', source: { key: KEY, server: 'notion', scope: 'user', transport: 'http', file: '/h/.claude.json' } };
    await send(notion(RUN(), { source: KEY }));
    expect(exported[0]).toMatchObject({ input: { artifactId: ART, format: 'md', ownFile: true }, options: { dialect: 'notion' } });
    expect(invoked.at(-1)!.input).toMatchObject({ source: KEY, format: 'md' });
    invoked = [];
    expect(await send(notion(RUN(), { format: 'docx' }))).toEqual({ ok: false, why: 'invalid' });
    expect(invoked).toEqual([]);
    expect(exported).toHaveLength(1);
  });

  // D38: a machine with no gws (the mini) reads Drive `absent`, and a send to it exports nothing
  it('refuses a Drive the machine cannot send to before anything is exported, as its state says', async () => {
    const cases: [DeliveryStatus, unknown][] = [
      [{ target: 'drive', state: 'absent' }, { ok: false, why: 'absent' }],
      [{ target: 'drive', state: 'needsSetup' }, { ok: false, why: 'needsSetup' }],
      [{ target: 'drive', state: 'signedOut' }, { ok: false, why: 'auth' }],
      [{ target: 'drive', state: 'expired', message: 'token expired' }, { ok: false, why: 'auth' }],
      [{ target: 'drive', state: 'noDrive', user: 'owner@example.com' }, { ok: false, why: 'auth' }],
      [{ target: 'drive', state: 'failed', message: 'gws broke' }, { ok: false, why: 'failed', message: 'gws broke' }],
    ];
    for (const [state, answer] of cases) {
      status = state;
      expect(await send(drive()), state.state).toEqual(answer);
    }
    expect(exported).toEqual([]);
    expect(names().every((name) => name === 'delivery.status')).toBe(true);
  });

  it('refuses a Notion the machine has no route to, or no connector for when the page named none, before anything is exported', async () => {
    status = { target: 'notion', state: 'unavailable' };
    expect(await send(notion())).toEqual({ ok: false, why: 'unavailable' });
    status = { target: 'notion', state: 'none', why: 'noSession' };
    expect(await send(notion())).toEqual({ ok: false, why: 'none' });
    expect(exported).toEqual([]);
    // a named source is the machine's to judge at the delivery, as before
    await send(notion(RUN(), { source: KEY }));
    expect(exported).toHaveLength(1);
  });

  it('answers unavailable, exporting nothing, when the machine cannot be asked its status', async () => {
    start({ invoke: (async () => ({ ok: false, error: { code: 'host_unavailable', message: 'mawsd is not running' } })) as never });
    expect(await send(drive())).toEqual({ ok: false, why: 'unavailable' });
    expect(exported).toEqual([]);
  });

  it('answers deleted or unavailable from the artifact’s read, before anything else', async () => {
    artifact = null;
    expect(await send(drive())).toEqual({ ok: false, why: 'deleted' });
    start({ call: (async () => ({ ok: false, error: { code: 'host_unavailable', message: 'down' } })) as never });
    expect(await send(drive())).toEqual({ ok: false, why: 'unavailable' });
    expect(exported).toEqual([]);
    expect(invoked).toEqual([]);
  });

  it('answers export when the export throws, handing nothing off', async () => {
    start({
      exportArtifact: async () => {
        throw new Error('the renderer crashed');
      },
    });
    expect(await send(drive())).toEqual({ ok: false, why: 'export', message: 'the renderer crashed' });
    expect(names()).toEqual(['delivery.status']);
  });

  it('removes the export and says it may have been sent when the hand-off itself fails', async () => {
    delivered = { ok: false, error: { code: 'timeout', message: 'delivery.deliver took too long' } };
    expect(await send(drive())).toEqual({ ok: false, why: 'timeout', maybeSent: true });
    expect(existsSync(exported[0]!.path)).toBe(false);
    delivered = { ok: false, error: { code: 'host_unavailable', message: 'mawsd went away' } };
    expect(await send(drive())).toEqual({ ok: false, why: 'unavailable', maybeSent: true });
    expect(existsSync(exported[1]!.path)).toBe(false);
  });

  it('answers busy for a run already under way, or for the same artifact and target meanwhile', async () => {
    let finish!: () => void;
    exporting = new Promise((resolve) => (finish = resolve));
    const runId = RUN();
    const first = send(drive(runId));
    await settle();
    expect(await send(drive(runId))).toEqual({ ok: false, why: 'busy' });
    expect(await send(drive())).toEqual({ ok: false, why: 'busy' });
    const other = send(notion()); // another target
    finish();
    expect(await first).toEqual({ ok: true, receipt: RECEIPT });
    expect(await other).toEqual({ ok: true, receipt: RECEIPT });
  });
});

// D15, D29: a cancel answered `cancelled` sends nothing, before the export and after it alike
describe('the cancel through the router’s seam', () => {
  it('stands before delivery.cancel alone', () => {
    expect(hookedNames).toEqual(['delivery.cancel']);
  });

  it('during the export phase: answers cancelled itself, lets the export finish, removes its file and hands nothing off', async () => {
    let finish!: () => void;
    exporting = new Promise((resolve) => (finish = resolve));
    const runId = RUN();
    const sending = send(drive(runId));
    await settle();
    expect(await cancel(runId)).toEqual({ ok: true, value: { cancelled: true } });
    finish();
    expect(await sending).toEqual({ ok: false, why: 'cancelled' });
    expect(exported).toHaveLength(1);
    expect(existsSync(exported[0]!.path)).toBe(false);
    expect(names()).toEqual(['delivery.status']);
  });

  it('during the status read: answers cancelled and exports nothing', async () => {
    let read!: () => void;
    const reading = new Promise<void>((resolve) => (read = resolve));
    start({
      invoke: (async (name: CommandName) => {
        invoked.push({ name, input: {}, client: 'main' });
        await reading;
        return { ok: true, value: status };
      }) as never,
    });
    const runId = RUN();
    const sending = send(drive(runId));
    await settle();
    expect(await cancel(runId)).toEqual({ ok: true, value: { cancelled: true } });
    read();
    expect(await sending).toEqual({ ok: false, why: 'cancelled' });
    expect(exported).toEqual([]);
  });

  it('lets a cancel of a run it does not hold go on to the machine: unknown, or already handed off', async () => {
    expect(await cancel(RUN())).toBeUndefined();
    let deliver!: () => void;
    const delivering = new Promise<void>((resolve) => (deliver = resolve));
    start({
      invoke: (async (name: CommandName, input: unknown) => {
        invoked.push({ name, input: input as never, client: 'main' });
        if (name === 'delivery.deliver') await delivering;
        return name === 'delivery.status' ? { ok: true, value: status } : delivered;
      }) as never,
    });
    const runId = RUN();
    const sending = send(drive(runId));
    await vi.waitFor(() => expect(names()).toContain('delivery.deliver'));
    expect(await cancel(runId)).toBeUndefined(); // the machine's run now (its tombstone if it has not begun)
    deliver();
    expect(await sending).toEqual({ ok: true, receipt: RECEIPT });
    expect(await cancel(runId)).toBeUndefined();
  });

  // The task review's finding 1: a run id is one operation's until the machine answered it, so a second send under it
  // never becomes the run a cancel marks while the first one is being delivered
  it('answers busy for a send reusing a run id still being delivered, and leaves that run’s cancel to the machine', async () => {
    let deliver!: () => void;
    const delivering = new Promise<void>((resolve) => (deliver = resolve));
    start({
      invoke: (async (name: CommandName, input: unknown) => {
        invoked.push({ name, input: input as never, client: 'main' });
        if (name === 'delivery.deliver') await delivering;
        return name === 'delivery.status' ? { ok: true, value: status } : delivered;
      }) as never,
    });
    const runId = RUN();
    const sending = send(drive(runId));
    await vi.waitFor(() => expect(names()).toContain('delivery.deliver'));
    expect(await send(drive(runId))).toEqual({ ok: false, why: 'busy' });
    expect(exported).toHaveLength(1);
    expect(await cancel(runId)).toBeUndefined(); // the machine's, the run being delivered
    deliver();
    expect(await sending).toEqual({ ok: true, receipt: RECEIPT });
    await send(drive(runId)); // once answered, the id is free again
    expect(exported).toHaveLength(2);
  });

  it('at the dispose, takes its hook away', () => {
    dispose();
    expect(hook).toBeNull();
  });
});
