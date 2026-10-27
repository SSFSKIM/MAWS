// The reference client's pure parts (O11 M7): joining the hub's parts, and the CLI's options — the token from stdin
// only, sent as Access's `cf-access-token`, and never in an error.
import { describe, expect, it } from 'vitest';
import { generateSigningKey } from '../src/keys.ts';
import { openTogether } from '../test-support/check.ts';
import { cliOptions } from '../test-support/cli.ts';
import { PartJoiner } from '../test-support/socket.ts';

/** A stand-in: the CLI never reads it, only passes it on. */
const TOKEN = 'stand-in-access-token';

describe('PartJoiner', () => {
  it('passes a whole frame through and joins a set of parts in any order', () => {
    const joiner = new PartJoiner();
    expect(joiner.add({ t: 'state', version: 3 })).toEqual({ t: 'state', version: 3 });
    const text = JSON.stringify({ t: 'listings', records: [] });
    const parts = [text.slice(0, 5), text.slice(5, 12), text.slice(12)].map((data, index) => ({ t: 'part', id: 'p1', index, count: 3, data }));
    expect(joiner.add(parts[2])).toBeUndefined();
    expect(joiner.add(parts[0])).toBeUndefined();
    expect(joiner.add(parts[1])).toEqual({ t: 'listings', records: [] });
  });
});

describe('cliOptions', () => {
  it('takes the token from stdin as cf-access-token, and the hub, project, machine and frames from arguments', async () => {
    const options = await cliOptions(['--hub', 'https://hub.test', '--project', 'p', '--machine', 'mini', '--frames', '8'], `DESK_ACCESS_TOKEN=${TOKEN}\n`);
    expect(options).toEqual({ hub: 'https://hub.test', headers: { 'cf-access-token': TOKEN }, project: 'p', machine: 'mini', frames: 8 });
  });

  it('reads a device file into the device id and its channel key', async () => {
    const key = await generateSigningKey(true);
    const jwk = await crypto.subtle.exportKey('jwk', key.privateKey);
    const options = await cliOptions(['--hub', 'https://hub.test', '--device-file', 'd.json', '--push-endpoint', 'https://push.test/x'], `DESK_ACCESS_TOKEN=${TOKEN}`, () => JSON.stringify({ id: 'a1', channel: jwk }));
    expect(options.device?.id).toBe('a1');
    expect(options.device?.key.pub).toBe(key.pub);
    expect(options.pushEndpoint).toBe('https://push.test/x');
  });

  it('refuses a missing token or hub without echoing what stdin held', async () => {
    await expect(cliOptions(['--hub', 'https://hub.test'], 'TOKEN=secret-thing')).rejects.toThrow(/no DESK_ACCESS_TOKEN/);
    await expect(cliOptions(['--hub', 'https://hub.test'], 'TOKEN=secret-thing')).rejects.not.toThrow(/secret-thing/);
    await expect(cliOptions([], `DESK_ACCESS_TOKEN=${TOKEN}`)).rejects.toThrow(/--hub/);
    await expect(cliOptions([], `DESK_ACCESS_TOKEN=${TOKEN}`)).rejects.not.toThrow(TOKEN);
  });
});

describe('openTogether', () => {
  const socket = () => {
    const s = { closed: false, close: () => void (s.closed = true) };
    return s;
  };

  it('answers every socket, undefined for one not asked for', async () => {
    const a = socket();
    const b = socket();
    expect(await openTogether([Promise.resolve(a), undefined, Promise.resolve(b)])).toEqual([a, undefined, b]);
    expect([a.closed, b.closed]).toEqual([false, false]);
  });

  it('closes every socket that opened, one opening after the refusal too, and throws the refusal', async () => {
    const early = socket();
    const late = socket();
    let openLate!: (s: typeof late) => void;
    const opening = openTogether([Promise.resolve(early), Promise.reject(new Error('the project socket was refused')), new Promise((resolve) => (openLate = resolve))]);
    setTimeout(() => openLate(late), 20);
    await expect(opening).rejects.toThrow('the project socket was refused');
    expect([early.closed, late.closed]).toEqual([true, true]);
  });
});
