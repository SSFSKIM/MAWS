// P5 O1 M6 (OX1): the committed wire manifest holds the code to the compatibility rule. A change to the wire between
// builds is additive (WIRE_MINOR bumped by one and the manifest rewritten) or breaking (a major). `pnpm wire:manifest`
// runs this file with MAWS_WIRE_MANIFEST_WRITE=1 to rewrite the manifest when the change allows it;
// MAWS_WIRE_MANIFEST_WRITE=rebase rewrites a rendering-only difference (a zod upgrade, an annotation) at the same minor.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { ClientHelloV2Schema, ServerWelcomeV2Schema, SOCKET_PROTOCOL } from '../host/socket-protocol';
import { HostRequestSchema, HostRequestV2Schema } from './host-protocol';
import { REGISTRY, type WireRegistry } from './registry';
import { classifyWireChange, WIRE_CAPABILITIES, WIRE_MAJOR, WIRE_MINOR, wireManifestOf, type WireManifest } from './wire';

const MANIFEST_PATH = fileURLToPath(new URL('./wire-manifest.json', import.meta.url));
const MODE = process.env.MAWS_WIRE_MANIFEST_WRITE;

// One minified entry per line, so a diff of the manifest shows which entries changed.
function formatManifest(manifest: WireManifest): string {
  const lines = Object.entries(manifest.entries).map(([name, entry]) => `${JSON.stringify(name)}:${JSON.stringify(entry)}`);
  return `{"major":${manifest.major},"minor":${manifest.minor},"capabilities":${JSON.stringify(manifest.capabilities)},"entries":{\n${lines.join(',\n')}\n}}\n`;
}

type Verdict = { ok: true; write: WireManifest | null } | { ok: false; message: string };
const RUN = 'run pnpm wire:manifest';

// What the gate says of `current` (at WIRE_MAJOR and WIRE_MINOR) against the committed manifest, in `mode`.
function verdict(committed: WireManifest | null, current: WireManifest, mode: string | undefined): Verdict {
  const fail = (message: string): Verdict => ({ ok: false, message });
  const write: Verdict = { ok: true, write: current };
  if (committed === null) return mode === '1' && current.minor === 0 ? write : fail(`no wire manifest is committed: set WIRE_MINOR to 0 and ${RUN}`);
  if (current.major !== committed.major) {
    if (current.major < committed.major) return fail(`WIRE_MAJOR ${current.major} is below the manifest’s ${committed.major}`);
    if (current.minor !== 0) return fail(`WIRE_MAJOR was raised to ${current.major}: a new major starts at WIRE_MINOR 0`);
    return mode === '1' ? write : fail(`WIRE_MAJOR was raised to ${current.major}: ${RUN} to record its wire`);
  }
  const { additive, breaking } = classifyWireChange(committed, current);
  if (breaking.length > 0) return fail(`breaking change to the wire at ${breaking.join(', ')}: it takes a major (raise WIRE_MAJOR with SOCKET_PROTOCOL); no minor can carry it`);
  if (additive.length > 0) {
    const at = `additive change to the wire at ${additive.join(', ')}`;
    if (current.minor === committed.minor) return fail(`${at}: bump WIRE_MINOR to ${committed.minor + 1} and ${RUN}`);
    if (current.minor !== committed.minor + 1) return fail(`${at}: WIRE_MINOR must be ${committed.minor + 1}, one past the manifest’s ${committed.minor}, not ${current.minor}`);
    return mode === '1' ? write : fail(`${at}, at WIRE_MINOR ${current.minor}: ${RUN} to record it`);
  }
  if (current.minor !== committed.minor) return fail(`WIRE_MINOR is ${current.minor}, but the wire has not changed since the manifest’s minor ${committed.minor}`);
  if (formatManifest(current) !== formatManifest(committed)) {
    return mode === 'rebase' ? write : fail('the wire manifest’s rendering differs with no change of shape (a zod upgrade, or an annotation): rewrite it with MAWS_WIRE_MANIFEST_WRITE=rebase pnpm wire:manifest');
  }
  return { ok: true, write: null };
}

// The production gate: this build's wire against the committed manifest. An authorized write (pnpm wire:manifest) comes
// first; the assertion after it is against what is committed then, so a valid minor or major rewrite passes as it is.
describe('the committed wire manifest', () => {
  it('holds this build’s wire: WIRE_MAJOR (the socket protocol), WIRE_MINOR, WIRE_CAPABILITIES and every entry', () => {
    expect(WIRE_MAJOR).toBe(SOCKET_PROTOCOL);
    const current = wireManifestOf(REGISTRY);
    const committed = existsSync(MANIFEST_PATH) ? (JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as WireManifest) : null;
    const answer = verdict(committed, current, MODE);
    if (!answer.ok) throw new Error(answer.message);
    if (answer.write) writeFileSync(MANIFEST_PATH, formatManifest(answer.write));
    expect(readFileSync(MANIFEST_PATH, 'utf8')).toBe(formatManifest(current));
  });
});

// The gate's verdicts on a manifest changed by hand, since a test cannot edit the registry's source.
describe('the manifest gate', () => {
  const base: WireManifest = { major: 3, minor: 4, capabilities: ['area.kept'], entries: { 'events.a': { type: 'object', properties: { x: { type: 'string' } }, required: ['x'], additionalProperties: false } } };
  const withEntry = (minor: number, entry: unknown, major = 3): WireManifest => ({ major, minor, capabilities: base.capabilities, entries: { 'events.a': entry } });
  const withCapabilities = (minor: number, capabilities: string[]): WireManifest => ({ ...base, minor, capabilities });
  const optionalAdded = { type: 'object', properties: { x: { type: 'string' }, y: { type: 'number' } }, required: ['x'], additionalProperties: false };

  it('passes an unchanged wire at the manifest’s minor, and refuses a minor bumped with nothing to record', () => {
    expect(verdict(base, base, undefined)).toEqual({ ok: true, write: null });
    expect(verdict(base, { ...base, minor: 5 }, undefined)).toMatchObject({ ok: false, message: expect.stringContaining('has not changed since the manifest’s minor 4') });
  });

  it('fails an additive change until WIRE_MINOR is one past the manifest’s and the manifest is rewritten', () => {
    expect(verdict(base, withEntry(4, optionalAdded), undefined)).toEqual({ ok: false, message: 'additive change to the wire at events.a.properties.y: bump WIRE_MINOR to 5 and run pnpm wire:manifest' });
    expect(verdict(base, withEntry(4, optionalAdded), '1')).toMatchObject({ ok: false });
    expect(verdict(base, withEntry(6, optionalAdded), '1')).toMatchObject({ ok: false, message: expect.stringContaining('WIRE_MINOR must be 5') });
    expect(verdict(base, withEntry(5, optionalAdded), undefined)).toMatchObject({ ok: false, message: expect.stringContaining('run pnpm wire:manifest to record it') });
    expect(verdict(base, withEntry(5, optionalAdded), '1')).toEqual({ ok: true, write: withEntry(5, optionalAdded) });
    expect(verdict(base, withEntry(5, optionalAdded), 'rebase')).toMatchObject({ ok: false });
  });

  it('fails a breaking change in every mode, naming each path and saying it takes a major', () => {
    const removed = { type: 'object', properties: {}, additionalProperties: false };
    for (const mode of [undefined, '1', 'rebase']) {
      expect(verdict(base, withEntry(5, removed), mode)).toEqual({ ok: false, message: 'breaking change to the wire at events.a.properties.x: it takes a major (raise WIRE_MAJOR with SOCKET_PROTOCOL); no minor can carry it' });
    }
  });

  it('records a raised major only at minor 0, whatever changed', () => {
    const removed = { type: 'object', properties: {}, additionalProperties: false };
    expect(verdict(base, withEntry(0, removed, 4), '1')).toEqual({ ok: true, write: withEntry(0, removed, 4) });
    expect(verdict(base, withEntry(1, removed, 4), '1')).toMatchObject({ ok: false, message: expect.stringContaining('starts at WIRE_MINOR 0') });
    expect(verdict(base, withEntry(0, removed, 4), undefined)).toMatchObject({ ok: false });
    expect(verdict(base, withEntry(0, removed, 2), '1')).toMatchObject({ ok: false, message: expect.stringContaining('below') });
  });

  it('writes a first manifest only at minor 0', () => {
    const first: WireManifest = { ...base, minor: 0, capabilities: [] };
    expect(verdict(null, first, '1')).toEqual({ ok: true, write: first });
    expect(verdict(null, first, undefined)).toMatchObject({ ok: false, message: expect.stringContaining('no wire manifest is committed') });
    expect(verdict(null, { ...first, minor: 1 }, '1')).toMatchObject({ ok: false, message: expect.stringContaining('set WIRE_MINOR to 0') });
  });

  it('takes an added capability as additive, a minor bump like any other; a removed one is breaking', () => {
    expect(verdict(base, withCapabilities(4, ['area.kept', 'area.added']), undefined)).toEqual({ ok: false, message: 'additive change to the wire at capabilities.area.added: bump WIRE_MINOR to 5 and run pnpm wire:manifest' });
    expect(verdict(base, withCapabilities(5, ['area.kept', 'area.added']), undefined)).toMatchObject({ ok: false, message: expect.stringContaining('run pnpm wire:manifest to record it') });
    expect(verdict(base, withCapabilities(5, ['area.kept', 'area.added']), '1')).toEqual({ ok: true, write: withCapabilities(5, ['area.kept', 'area.added']) });
    expect(verdict(base, withCapabilities(5, []), '1')).toEqual({ ok: false, message: 'breaking change to the wire at capabilities.area.kept: it takes a major (raise WIRE_MAJOR with SOCKET_PROTOCOL); no minor can carry it' });
  });

  it('rewrites a rendering-only difference only under rebase, at the same minor', () => {
    const described = { ...(base.entries['events.a'] as object), description: 'now described' };
    expect(verdict(base, withEntry(4, described), undefined)).toMatchObject({ ok: false, message: expect.stringContaining('MAWS_WIRE_MANIFEST_WRITE=rebase') });
    expect(verdict(base, withEntry(4, described), 'rebase')).toEqual({ ok: true, write: withEntry(4, described) });
    expect(verdict(base, withEntry(5, described), 'rebase')).toMatchObject({ ok: false });
  });
});

describe('wireManifestOf', () => {
  const fixture = {
    commands: {
      'probe.host': { input: z.strictObject({ a: z.string() }), output: z.void(), owner: 'engine-host' },
      'probe.machine': { input: z.void(), output: z.strictObject({ b: z.number() }), owner: 'machine' },
      'probe.main': { input: z.void(), output: z.void(), owner: 'main' },
      'probe.pty': { input: z.void(), output: z.void(), owner: 'pty-host' },
    },
    events: { 'probe.hostEvent': z.strictObject({ c: z.boolean() }), 'probe.mainEvent': z.strictObject({}) },
    hostEvents: ['probe.hostEvent'],
    mainOnly: new Set<string>(),
  } satisfies WireRegistry;

  it('covers the engine host’s and machine’s commands, the host events, the envelope and the socket layer, and nothing else', () => {
    const manifest = wireManifestOf(fixture);
    expect(manifest).toMatchObject({ major: WIRE_MAJOR, minor: WIRE_MINOR, capabilities: [...WIRE_CAPABILITIES].sort() });
    expect(wireManifestOf(fixture, ['b.second', 'a.first']).capabilities).toEqual(['a.first', 'b.second']);
    expect(Object.keys(manifest.entries)).toEqual(
      [
        'commands.probe.host',
        'commands.probe.machine',
        'events.probe.hostEvent',
        ...['clientGone', 'doc', 'evt', 'ready', 'req', 'res'].map((t) => `envelope.${t}`),
        ...['documents.close', 'documents.closed', 'documents.open', 'exit', 'hello', 'refuse', 'welcome'].map((t) => `socket.${t}`),
        ...['documents.close', 'documents.closed', 'documents.open', 'evt', 'exit', 'hello', 'ready', 'refuse', 'req', 'res', 'welcome'].map((t) => `socket.v2.${t}`),
      ].sort(),
    );
    expect(manifest.entries['commands.probe.host']).toEqual({ owner: 'engine-host', input: z.toJSONSchema(fixture.commands['probe.host'].input, { unrepresentable: 'any' }), output: { $schema: 'https://json-schema.org/draft/2020-12/schema' } });
  });
});

describe('classifyWireChange', () => {
  const manifest = (entries: Record<string, unknown>, capabilities: string[] = []): WireManifest => ({ major: 3, minor: 0, capabilities, entries });
  const render = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any' });
  const event = (schema: z.ZodType) => manifest({ 'events.e': render(schema) });
  const classify = (was: z.ZodType, now: z.ZodType) => classifyWireChange(event(was), event(now));

  it('an added optional key is additive', () => {
    expect(classify(z.strictObject({ a: z.string() }), z.strictObject({ a: z.string(), foo: z.string().optional() }))).toEqual({ additive: ['events.e.properties.foo'], breaking: [] });
  });

  it('an added required key is breaking', () => {
    expect(classify(z.strictObject({ a: z.string() }), z.strictObject({ a: z.string(), foo: z.string() }))).toEqual({ additive: [], breaking: ['events.e.properties.foo'] });
  });

  it('a removed key is breaking', () => {
    expect(classify(z.strictObject({ a: z.string(), b: z.number() }), z.strictObject({ a: z.string() }))).toEqual({ additive: [], breaking: ['events.e.properties.b'] });
  });

  it('a key made optional, or made required, is breaking', () => {
    expect(classify(z.strictObject({ a: z.string() }), z.strictObject({ a: z.string().optional() }))).toEqual({ additive: [], breaking: ['events.e.properties.a'] });
    expect(classify(z.strictObject({ a: z.string().optional() }), z.strictObject({ a: z.string() }))).toEqual({ additive: [], breaking: ['events.e.properties.a'] });
  });

  it('an added enum member is breaking', () => {
    expect(classify(z.strictObject({ k: z.enum(['a', 'b']) }), z.strictObject({ k: z.enum(['a', 'b', 'c']) }))).toEqual({ additive: [], breaking: ['events.e.properties.k.enum'] });
  });

  it('a changed maxLength is breaking', () => {
    expect(classify(z.strictObject({ s: z.string().max(10) }), z.strictObject({ s: z.string().max(11) }))).toEqual({ additive: [], breaking: ['events.e.properties.s.maxLength'] });
  });

  it('a union member added is breaking; an optional key added inside a member is additive', () => {
    const one = z.strictObject({ kind: z.literal('a') });
    const two = z.strictObject({ kind: z.literal('b') });
    expect(classify(z.union([one, two]), z.union([one, two, z.strictObject({ kind: z.literal('c') })]))).toEqual({ additive: [], breaking: ['events.e.anyOf'] });
    expect(classify(z.discriminatedUnion('kind', [one, two]), z.discriminatedUnion('kind', [one, two.extend({ note: z.string().optional() })]))).toEqual({ additive: ['events.e.oneOf.1.properties.note'], breaking: [] });
  });

  it('reaches a nested object two levels down, and an array’s items and a record’s values', () => {
    const was = z.strictObject({ top: z.strictObject({ mid: z.strictObject({ leaf: z.number() }) }), list: z.array(z.strictObject({ a: z.number() })), byId: z.record(z.string(), z.strictObject({ a: z.number() })) });
    const now = z.strictObject({
      top: z.strictObject({ mid: z.strictObject({ leaf: z.number(), added: z.boolean().optional() }) }),
      list: z.array(z.strictObject({ a: z.number(), added: z.boolean().optional() })),
      byId: z.record(z.string(), z.strictObject({ a: z.number(), added: z.boolean().optional() })),
    });
    expect(classify(was, now)).toEqual({ additive: ['events.e.properties.top.properties.mid.properties.added', 'events.e.properties.list.items.properties.added', 'events.e.properties.byId.additionalProperties.properties.added'], breaking: [] });
  });

  it('a changed type, const, bound or additionalProperties is breaking', () => {
    expect(classify(z.strictObject({ a: z.string() }), z.strictObject({ a: z.number() })).breaking).toEqual(['events.e.properties.a.type']);
    expect(classify(z.strictObject({ a: z.literal('x') }), z.strictObject({ a: z.literal('y') })).breaking).toEqual(['events.e.properties.a.const']);
    expect(classify(z.strictObject({ n: z.number().int().max(5) }), z.strictObject({ n: z.number().int().max(6) })).breaking).toEqual(['events.e.properties.n.maximum']);
    expect(classify(z.strictObject({ a: z.string() }), z.looseObject({ a: z.string() })).breaking).toEqual(['events.e.additionalProperties']);
    expect(classify(z.strictObject({ a: z.string() }), z.strictObject({ a: z.string().nullable() })).breaking).toEqual(['events.e.properties.a.type']);
  });

  it('an added command or event is additive; a removed one, or a changed owner, breaking; an annotation is neither', () => {
    const command = (owner: string) => ({ owner, input: render(z.void()), output: render(z.void()) });
    expect(classifyWireChange(manifest({ 'commands.a': command('engine-host') }), manifest({ 'commands.a': command('engine-host'), 'commands.b': command('machine'), 'events.e': render(z.strictObject({})) }))).toEqual({ additive: ['commands.b', 'events.e'], breaking: [] });
    expect(classifyWireChange(manifest({ 'commands.a': command('engine-host'), 'commands.b': command('machine') }), manifest({ 'commands.a': command('machine') }))).toEqual({ additive: [], breaking: ['commands.a.owner', 'commands.b'] });
    expect(classify(z.strictObject({ a: z.string() }), z.strictObject({ a: z.string().describe('the a') }))).toEqual({ additive: [], breaking: [] });
  });

  it('a new socket or envelope message kind is breaking: an older peer closes the connection on a line it cannot read', () => {
    const line = render(z.strictObject({ t: z.literal('x') }));
    expect(classifyWireChange(manifest({}), manifest({ 'socket.documents.reopen': line, 'envelope.ping': line }))).toEqual({ additive: [], breaking: ['envelope.ping', 'socket.documents.reopen'] });
  });

  it('an added capability is additive; a removed one is breaking', () => {
    expect(classifyWireChange(manifest({}, ['a.kept']), manifest({}, ['a.kept', 'b.added']))).toEqual({ additive: ['capabilities.b.added'], breaking: [] });
    expect(classifyWireChange(manifest({}, ['a.kept', 'b.gone']), manifest({}, ['a.kept']))).toEqual({ additive: [], breaking: ['capabilities.b.gone'] });
  });

  it('a protocol-2 form is frozen: an optional field added to v2.hello or v2.welcome is breaking; an annotation is not', () => {
    const frozen = (name: string, was: z.ZodType, now: z.ZodType) => classifyWireChange(manifest({ [name]: render(was) }), manifest({ [name]: render(now) }));
    const extra = { extra: z.string().optional() };
    expect(frozen('socket.v2.hello', ClientHelloV2Schema, ClientHelloV2Schema.extend(extra))).toEqual({ additive: [], breaking: ['socket.v2.hello.properties.extra'] });
    expect(frozen('socket.v2.welcome', ServerWelcomeV2Schema, ServerWelcomeV2Schema.extend(extra))).toEqual({ additive: [], breaking: ['socket.v2.welcome.properties.extra'] });
    expect(frozen('socket.v2.hello', ClientHelloV2Schema, ClientHelloV2Schema.describe('protocol 2’s hello'))).toEqual({ additive: [], breaking: [] });
    expect(frozen('socket.v2.welcome', ServerWelcomeV2Schema, ServerWelcomeV2Schema.describe('protocol 2’s welcome'))).toEqual({ additive: [], breaking: [] });
  });
});

describe('the protocol-2 link’s lines', () => {
  // A v2 form split from its current form (so the current one can grow) is the current form less the fields its writer
  // keeps off a protocol-2 link. A field added to the current form fails this until its writer keeps it off too.
  it('a request differs from its v2 form only in `client`, which main sets only on a `machine` host’s link', () => {
    const current = z.toJSONSchema(HostRequestSchema, { unrepresentable: 'any' }) as { properties: Record<string, unknown> };
    delete current.properties.client;
    expect(current).toEqual(z.toJSONSchema(HostRequestV2Schema, { unrepresentable: 'any' }));
  });
});
