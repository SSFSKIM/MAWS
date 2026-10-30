import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { item, project, record } from '../../../test/support/builders';
import { AppSessionIdSchema, AttentionIdSchema, LooseAppSessionIdSchema, ProjectIdSchema, type AppSessionId, type AttentionId } from '../graph/ids';
import { SessionEventSchema } from '../graph/events';
import { REGISTRY } from '../ipc/registry';
import { PtyIdSchema, type PtyInfo } from '../ipc/schema/pty';
import { addressedPaths, addressingOf, addressOf, bareOf, compileAddressing, isAddress, machineOf } from './address';
import type { MachineRef } from './ref';

const A = 'machineAAAAAAAAAAAAAAA' as MachineRef;
const B = 'machine-B_0123456789xy' as MachineRef;
const at = (machine: MachineRef, id: string) => `${machine}/${id}`;

describe('the codec', () => {
  it('joins a ref and an id at the first slash, and splits them back', () => {
    const address = addressOf(A, 'app-1' as AppSessionId);
    expect(address).toBe(`${A}/app-1`);
    expect(isAddress(address)).toBe(true);
    expect(machineOf(address)).toBe(A);
    expect(bareOf(address)).toBe('app-1');
  });

  it('keeps a slash inside the bare part, since only the first one separates', () => {
    const address = addressOf(A, '/Users/me/project');
    expect(machineOf(address)).toBe(A);
    expect(bareOf(address)).toBe('/Users/me/project');
  });

  it('refuses a ref containing a slash, or any ref outside the format, and an empty id', () => {
    expect(() => addressOf('abcdefgh/ijklmnop' as MachineRef, 'app-1')).toThrow('not a machine ref');
    expect(() => addressOf('short' as MachineRef, 'app-1')).toThrow('not a machine ref');
    expect(() => addressOf(A, '')).toThrow('non-empty id');
  });

  it('tells an address from a bare id', () => {
    for (const bare of ['app-1', '', `${A}/`, '/app-1', 'short/app-1', 'not a ref at all/x', '6f1c2c1e-6ad1-4bd4-9e2a-8c1a0c3b2d11']) {
      expect(isAddress(bare), bare).toBe(false);
      expect(() => machineOf(bare)).toThrow('not an address');
      expect(() => bareOf(bare)).toThrow('not an address');
    }
  });
});

describe('compiling the registry', () => {
  it('compiles every command input and output and every event payload without throwing', () => {
    const codecs = addressingOf(REGISTRY);
    for (const name of Object.keys(REGISTRY.commands)) {
      expect(() => codecs.input(name), name).not.toThrow();
      expect(() => codecs.output(name), name).not.toThrow();
    }
    for (const name of Object.keys(REGISTRY.events)) expect(() => codecs.event(name), name).not.toThrow();
  });

  it('refuses a name the registry does not hold', () => {
    expect(() => addressingOf(REGISTRY).input('nope.nothing')).toThrow('no schema is registered for commands.nope.nothing.input');
    expect(() => addressingOf(REGISTRY).event('toString')).toThrow('no schema is registered');
  });
});

// Round trips: lift with one machine, lower back, and the machines reported are that one.
function roundTrip<T>(schema: z.ZodType, bare: T, lifted: T, machine: MachineRef = A): void {
  const codec = compileAddressing(schema);
  expect(codec.lift(bare, machine)).toEqual(lifted);
  const lowered = codec.lower(lifted);
  expect(lowered.value).toEqual(bare);
  expect([...lowered.machines]).toEqual(JSON.stringify(bare) === JSON.stringify(lifted) ? [] : [machine]);
}

describe('each construct the compile step walks', () => {
  it('object properties, for each of the four kinds and the loose alias', () => {
    const schema = z.strictObject({ s: AppSessionIdSchema, p: ProjectIdSchema, t: PtyIdSchema, a: AttentionIdSchema, l: LooseAppSessionIdSchema, other: z.string() });
    roundTrip(schema, { s: 's1', p: 'p1', t: 't1', a: 'a1', l: 'l1', other: 'x' }, { s: at(A, 's1'), p: at(A, 'p1'), t: at(A, 't1'), a: at(A, 'a1'), l: at(A, 'l1'), other: 'x' });
  });

  it("an object's catchall", () => {
    const schema = z.object({ fixed: z.string() }).catchall(AppSessionIdSchema);
    roundTrip(schema, { fixed: 'f', x: 'a1', y: 'a2' }, { fixed: 'f', x: at(A, 'a1'), y: at(A, 'a2') });
  });

  it('array and tuple elements, a tuple rest included', () => {
    roundTrip(z.array(AppSessionIdSchema), ['a1', 'a2'], [at(A, 'a1'), at(A, 'a2')]);
    const tuple = z.tuple([z.number(), ProjectIdSchema], AppSessionIdSchema);
    roundTrip(tuple, [1, 'p1', 'a1', 'a2'], [1, at(A, 'p1'), at(A, 'a1'), at(A, 'a2')]);
  });

  it('record keys and values, a record keyed by an id among them', () => {
    roundTrip(z.record(AppSessionIdSchema, z.number()), { a1: 1, a2: 2 }, { [at(A, 'a1')]: 1, [at(A, 'a2')]: 2 });
    roundTrip(z.record(z.string(), PtyIdSchema), { k: 't1' }, { k: at(A, 't1') });
    roundTrip(z.record(AppSessionIdSchema, z.array(ProjectIdSchema)), { a1: ['p1'] }, { [at(A, 'a1')]: [at(A, 'p1')] });
  });

  it('a record key of __proto__ stays an own key', () => {
    const codec = compileAddressing(z.record(z.string(), AppSessionIdSchema));
    const bare = JSON.parse('{"__proto__":"a1"}') as Record<string, string>;
    const lifted = codec.lift(bare, A);
    expect(Object.getPrototypeOf(lifted)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(lifted, '__proto__')?.value).toBe(at(A, 'a1'));
  });

  it('the optional, nullable, default, prefault, nonoptional, readonly and catch wrappers', () => {
    const schema = z.strictObject({
      o: AppSessionIdSchema.optional(),
      n: AppSessionIdSchema.nullable(),
      d: AppSessionIdSchema.default('a0' as AppSessionId),
      pf: AppSessionIdSchema.prefault('a0'),
      no: AppSessionIdSchema.optional().nonoptional(),
      r: z.array(AppSessionIdSchema).readonly(),
      c: AppSessionIdSchema.catch('a0' as AppSessionId),
    });
    const bare = { o: 'a1', n: null, d: 'a2', pf: 'a3', no: 'a4', r: ['a5'], c: 'a6' };
    roundTrip(schema, bare, { o: at(A, 'a1'), n: null, d: at(A, 'a2'), pf: at(A, 'a3'), no: at(A, 'a4'), r: [at(A, 'a5')], c: at(A, 'a6') });
    const absent = { n: null, d: 'a2', pf: 'a3', no: 'a4', r: [], c: 'a6' };
    expect(compileAddressing(schema).lift(absent, A)).toEqual({ n: null, d: at(A, 'a2'), pf: at(A, 'a3'), no: at(A, 'a4'), r: [], c: at(A, 'a6') });
  });

  it("a pipe: its input side when lowering, its output side when lifting", () => {
    const inSide = z.strictObject({ id: AppSessionIdSchema });
    const outSide = z.strictObject({ id: z.string() });
    const piped = (inSide as z.ZodType).pipe(outSide as z.ZodType); // the brand's type does not reach a plain string's input; the walk is what is tested
    expect(compileAddressing(piped).lower({ id: at(A, 'a1') }).value).toEqual({ id: 'a1' }); // in: the id
    expect(compileAddressing(piped).lift({ id: 'a1' }, A)).toEqual({ id: 'a1' }); // out: a plain string
    const reversed = outSide.pipe(inSide);
    expect(compileAddressing(reversed).lift({ id: 'a1' }, A)).toEqual({ id: at(A, 'a1') });
    expect(compileAddressing(reversed).lower({ id: 'a1' }).value).toEqual({ id: 'a1' });
  });

  it('refuses an id behind a transform it cannot see through, naming the path', () => {
    const preprocessed = z.strictObject({ inner: z.preprocess((value) => value, z.strictObject({ id: AppSessionIdSchema })) });
    expect(() => compileAddressing(preprocessed)).toThrow('.inner: an id sits behind a transform');
    const transformed = z.strictObject({ id: AppSessionIdSchema }).transform((value) => value.id);
    expect(() => compileAddressing(transformed)).toThrow('the value itself: an id sits behind a transform');
  });

  it('refuses an id inside an intersection, a map or a set', () => {
    expect(() => compileAddressing(z.strictObject({ i: z.intersection(z.object({ a: AppSessionIdSchema }), z.object({ b: z.string() })) }))).toThrow('.i: an id inside a intersection');
    expect(() => compileAddressing(z.map(AppSessionIdSchema, z.number()))).toThrow('an id inside a map');
    expect(() => compileAddressing(z.set(PtyIdSchema))).toThrow('an id inside a set');
    expect(() => compileAddressing(z.map(z.string(), z.number()))).not.toThrow();
  });

  it('a lazy, recursive tree, at every depth', () => {
    type Node = { id: string; children: Node[] };
    const NodeSchema: z.ZodType<Node> = z.lazy(() => z.strictObject({ id: AppSessionIdSchema, children: z.array(NodeSchema) }));
    const bare: Node = { id: 'r', children: [{ id: 'c1', children: [{ id: 'g1', children: [] }] }, { id: 'c2', children: [] }] };
    const lifted: Node = { id: at(A, 'r'), children: [{ id: at(A, 'c1'), children: [{ id: at(A, 'g1'), children: [] }] }, { id: at(A, 'c2'), children: [] }] };
    roundTrip(NodeSchema, bare, lifted);
    expect(addressedPaths(NodeSchema, 'lift')).toEqual(['.id AppSessionId']);
  });

  it('a lazy, recursive schema with no id is the identity', () => {
    type Node = { name: string; children: Node[] };
    const NodeSchema: z.ZodType<Node> = z.lazy(() => z.strictObject({ name: z.string(), children: z.array(NodeSchema) }));
    const value: Node = { name: 'r', children: [{ name: 'c', children: [] }] };
    expect(compileAddressing(z.strictObject({ tree: NodeSchema, id: AppSessionIdSchema })).lift({ tree: value, id: 'a1' }, A).tree).toBe(value);
    expect(addressedPaths(NodeSchema, 'lift')).toEqual([]);
  });

  it('a discriminated union carrying ids in one option, dispatched by its discriminator', () => {
    const schema = z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('child'), childAppSessionId: AppSessionIdSchema }),
      z.strictObject({ kind: z.enum(['note', 'mark']), childAppSessionId: z.string() }), // same key, not an id: dispatch keeps them apart
    ]);
    roundTrip(schema, { kind: 'child', childAppSessionId: 'a1' }, { kind: 'child', childAppSessionId: at(A, 'a1') });
    const note = { kind: 'note', childAppSessionId: 'plain' };
    expect(compileAddressing(schema).lift(note, A)).toBe(note);
    expect(addressedPaths(schema, 'lift')).toEqual(['<kind=child>.childAppSessionId AppSessionId']);
  });

  it('a discriminated union in a plain union with null is still dispatched', () => {
    const union = z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('child'), ref: AppSessionIdSchema }),
      z.strictObject({ kind: z.literal('note'), ref: z.string() }),
    ]);
    const schema = z.strictObject({ last: z.union([union, z.null()]) });
    roundTrip(schema, { last: { kind: 'child', ref: 'a1' } }, { last: { kind: 'child', ref: at(A, 'a1') } });
    roundTrip(schema, { last: { kind: 'note', ref: 'plain' } }, { last: { kind: 'note', ref: 'plain' } });
    roundTrip(schema, { last: null }, { last: null });
  });

  it('a nested discriminated union', () => {
    const inner = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('a'), id: PtyIdSchema }), z.strictObject({ kind: z.literal('b') })]);
    const outer = z.discriminatedUnion('kind', [inner, z.strictObject({ kind: z.literal('c'), id: ProjectIdSchema })]);
    roundTrip(outer, { kind: 'a', id: 't1' }, { kind: 'a', id: at(A, 't1') });
    roundTrip(outer, { kind: 'c', id: 'p1' }, { kind: 'c', id: at(A, 'p1') });
    roundTrip(outer, { kind: 'b' }, { kind: 'b' });
  });

  it('a plain union applies the union of its options’ rewrites to whichever keys are present', () => {
    const schema = z.union([z.strictObject({ a: AppSessionIdSchema, n: z.number() }), z.strictObject({ a: AppSessionIdSchema.nullable(), p: ProjectIdSchema })]);
    roundTrip(schema, { a: 'a1', n: 1 }, { a: at(A, 'a1'), n: 1 });
    roundTrip(schema, { a: null, p: 'p1' }, { a: null, p: at(A, 'p1') });
    expect(addressedPaths(schema, 'lift')).toEqual(['.a AppSessionId', '.p ProjectId']);
  });

  it('a plain union of an id and an object is told apart by the value’s type', () => {
    const schema = z.strictObject({ target: z.union([AppSessionIdSchema, z.strictObject({ project: ProjectIdSchema }), z.array(PtyIdSchema)]) });
    roundTrip(schema, { target: 'a1' }, { target: at(A, 'a1') });
    roundTrip(schema, { target: { project: 'p1' } }, { target: { project: at(A, 'p1') } });
    roundTrip(schema, { target: ['t1'] }, { target: [at(A, 't1')] });
  });

  it('a plain union whose options disagree at a path throws, naming it', () => {
    const disagree = z.strictObject({ outer: z.union([z.strictObject({ id: AppSessionIdSchema }), z.strictObject({ id: z.string() })]) });
    expect(() => compileAddressing(disagree)).toThrow(".outer.id: a union's options disagree");
    const literal = z.union([ProjectIdSchema, z.literal('none')]);
    expect(() => compileAddressing(literal)).toThrow("the value itself: a union's options disagree");
  });

  // The task review's four overlaps, each a plain string (or an unknown) that a lift would otherwise rewrite, or an id it
  // would miss.
  it("compares an object's property with a record's value beside it", () => {
    const schema = z.union([z.strictObject({ a: AppSessionIdSchema }), z.record(z.string(), z.string())]);
    expect(() => compileAddressing(schema)).toThrow(".a: a union's options disagree, an id in one and a plain string in another");
    const agreeing = z.union([z.strictObject({ a: AppSessionIdSchema }), z.record(z.string(), AppSessionIdSchema)]);
    roundTrip(agreeing, { a: 'a1', b: 'a2' }, { a: at(A, 'a1'), b: at(A, 'a2') });
  });

  it("compares a tuple's item with another tuple's rest, and with an array's element", () => {
    const withRest = z.union([z.tuple([z.number(), AppSessionIdSchema]), z.tuple([z.number()], z.string())]); // index 1: an id, or the rest's plain string
    expect(() => compileAddressing(withRest)).toThrow("[1]: a union's options disagree, an id in one and a plain string in another");
    const withArray = z.union([z.tuple([AppSessionIdSchema, z.number()]), z.array(z.string())]);
    expect(() => compileAddressing(withArray)).toThrow("[0]: a union's options disagree");
    const agreeing = z.union([z.tuple([AppSessionIdSchema]), z.array(AppSessionIdSchema)]);
    roundTrip(agreeing, ['a1', 'a2'], [at(A, 'a1'), at(A, 'a2')]);
  });

  it("compares an id catchall with a property another option declares a plain string", () => {
    const schema = z.union([z.object({}).catchall(AppSessionIdSchema), z.strictObject({ a: z.string() })]);
    expect(() => compileAddressing(schema)).toThrow(".a: a union's options disagree, an id in one and a plain string in another");
    const strictBeside = z.union([z.strictObject({ b: z.number() }), z.strictObject({ a: AppSessionIdSchema })]); // a strict object's catchall applies nowhere
    roundTrip(strictBeside, { a: 'a1' }, { a: at(A, 'a1') });
  });

  it('refuses an id beside an opaque unknown, any or custom, which cannot agree', () => {
    expect(() => compileAddressing(z.union([AppSessionIdSchema, z.unknown()]))).toThrow("the value itself: a union's options disagree, an id in one and an opaque value");
    expect(() => compileAddressing(z.strictObject({ x: z.union([z.strictObject({ a: PtyIdSchema }), z.any()]) }))).toThrow(".x: a union's options disagree");
    expect(() => compileAddressing(z.union([z.strictObject({ a: AppSessionIdSchema }), z.looseObject({})]))).toThrow(".a: a union's options disagree, an id in one and an opaque value");
    expect(() => compileAddressing(z.union([z.string(), z.unknown()]))).not.toThrow(); // no id: nothing to agree on
  });

  it('refuses an id beside any member the walk cannot classify, an id-free intersection among them', () => {
    const opaque: [string, z.ZodType][] = [
      ['intersection', z.intersection(z.string(), z.string())],
      ['map', z.map(z.string(), z.string())],
      ['set', z.set(z.string())],
      ['transform', z.string().transform((value) => value)],
      ['lazy intersection', z.lazy(() => z.intersection(z.string(), z.string()))],
      ['date', z.date()],
    ];
    for (const [name, member] of opaque) {
      expect(() => compileAddressing(z.union([AppSessionIdSchema, member])), name).toThrow("the value itself: a union's options disagree, an id in one and an opaque value, which the walk cannot see into");
      expect(() => compileAddressing(z.union([z.string(), member])), name).not.toThrow(); // no id: nothing to agree on
    }
    // primitives that are never strings, objects or arrays stay beside an id
    roundTrip(z.union([AppSessionIdSchema, z.null(), z.number(), z.boolean(), z.undefined()]), 'a1', at(A, 'a1'));
  });

  it('refuses a record keyed by ids beside an object, whose property names are no ids', () => {
    expect(() => compileAddressing(z.union([z.record(AppSessionIdSchema, z.number()), z.strictObject({ n: z.number() })]))).toThrow("the value itself: a union's options disagree, a record keyed by ids");
  });

  it('an id-free schema is the identity: the very value comes back', () => {
    const codec = compileAddressing(z.strictObject({ name: z.string(), items: z.array(z.strictObject({ n: z.number() })) }));
    const value = { name: 'x', items: [{ n: 1 }] };
    expect(codec.lift(value, A)).toBe(value);
    expect(codec.lower(value).value).toBe(value);
  });

  it('copies only along the touched paths and shares every untouched subtree', () => {
    const schema = z.strictObject({ id: AppSessionIdSchema, meta: z.strictObject({ deep: z.array(z.number()) }), list: z.array(z.strictObject({ p: ProjectIdSchema.nullable(), x: z.number() })) });
    const value = { id: 'a1', meta: { deep: [1, 2] }, list: [{ p: null, x: 1 }, { p: 'p1', x: 2 }] };
    const lifted = compileAddressing(schema).lift(value, A);
    expect(lifted).not.toBe(value);
    expect(lifted.meta).toBe(value.meta);
    expect(lifted.list[0]).toBe(value.list[0]); // its id is null: untouched
    expect(lifted.list[1]).not.toBe(value.list[1]);
    expect(value).toEqual({ id: 'a1', meta: { deep: [1, 2] }, list: [{ p: null, x: 1 }, { p: 'p1', x: 2 }] }); // the input is never mutated
  });
});

describe('lowering and lifting refuse the wrong form', () => {
  const schema = z.strictObject({ a: AppSessionIdSchema, list: z.array(z.strictObject({ p: ProjectIdSchema })) });

  it('lowering a value that names two machines reports both', () => {
    const { value, machines } = compileAddressing(schema).lower({ a: at(A, 'a1'), list: [{ p: at(B, 'p1') }, { p: at(A, 'p2') }] });
    expect(value).toEqual({ a: 'a1', list: [{ p: 'p1' }, { p: 'p2' }] });
    expect([...machines].sort()).toEqual([A, B].sort());
  });

  it('throws on lifting a value already lifted, naming the path', () => {
    const codec = compileAddressing(schema);
    const once = codec.lift({ a: 'a1', list: [{ p: 'p1' }] }, A);
    expect(() => codec.lift(once, A)).toThrow(`lift: .a already holds an address, "${at(A, 'a1')}"`);
    expect(() => codec.lift({ a: 'a1', list: [{ p: at(B, 'p1') }] }, A)).toThrow('lift: .list[].p already holds an address');
  });

  it('throws on a bare id met while lowering, naming the path', () => {
    expect(() => compileAddressing(schema).lower({ a: at(A, 'a1'), list: [{ p: 'p1' }] })).toThrow('lower: .list[].p holds a bare id where an address belongs, "p1"');
  });

  it('throws on lifting an empty loose id, which no address can carry', () => {
    const loose = compileAddressing(z.strictObject({ id: LooseAppSessionIdSchema, pty: PtyIdSchema.optional() }));
    expect(() => loose.lift({ id: '' }, A)).toThrow('lift: .id holds an empty id');
    expect(() => loose.lift({ id: 'a1', pty: '' }, A)).toThrow('lift: .pty holds an empty id');
    expect(loose.lift({ id: 'a1' }, A)).toEqual({ id: at(A, 'a1') });
  });

  it('refuses to lift with a machine that is not a ref', () => {
    expect(() => compileAddressing(schema).lift({ a: 'a1', list: [] }, 'bad/ref' as MachineRef)).toThrow('lift: not a machine ref');
  });
});

// One real value per payload family the renderer receives most, built with the repository's test builders.
describe('real payloads', () => {
  const codecs = addressingOf(REGISTRY);

  it('a SessionRecord, through session.list', () => {
    const child = record('child-1', { projectId: project('proj-1', 0).id, lineage: { kind: 'fork', parentAppSessionId: 'root-1' as AppSessionId, parentEngineSessionId: null, openedBy: 'fork' } });
    const bare = { sessions: [record('root-1'), child], revision: 3 };
    const lifted = codecs.output('session.list').lift(bare, A);
    expect(lifted.sessions.map((session) => session.appId)).toEqual([at(A, 'root-1'), at(A, 'child-1')]);
    expect(lifted.sessions[1].projectId).toBe(at(A, 'proj-1'));
    expect(lifted.sessions[1].lineage?.parentAppSessionId).toBe(at(A, 'root-1'));
    expect(lifted.sessions[1].engineSessionId).toBe('eng-child-1'); // the engine's id is not lifted
    expect(codecs.output('session.list').lower(lifted)).toEqual({ value: bare, machines: new Set([A]) });
  });

  it('a ProjectRecord, through session.projects.list', () => {
    const bare = { projects: [project('proj-1', 0), project('proj-2', 1)], revision: 1 };
    const lifted = codecs.output('session.projects.list').lift(bare, A);
    expect(lifted.projects.map((p) => p.id)).toEqual([at(A, 'proj-1'), at(A, 'proj-2')]);
    expect(lifted.projects[0].directory).toBe('/work/proj-1');
    expect(codecs.output('session.projects.list').lower(lifted).value).toEqual(bare);
  });

  it('an AttentionItem, through attention.list and attention.changed', () => {
    const bare = [item('app-1', 'permission', '2026-09-28T10:00:00.000Z', { id: 'app-1:req-app-1' as AttentionId })]; // the broker's form
    const lifted = codecs.output('attention.list').lift(bare, A);
    expect(lifted[0].id).toBe(at(A, bare[0].id));
    expect(lifted[0].id.startsWith(lifted[0].appSessionId)).toBe(true); // an AttentionId still begins with its session's id
    expect(lifted[0].request.requestId).toBe('req-app-1'); // within-session ids are not lifted
    const event = codecs.event('attention.changed').lift({ appSessionId: 'app-1' as AppSessionId, items: bare }, A);
    expect(event.items[0].appSessionId).toBe(at(A, 'app-1'));
    expect(codecs.output('attention.list').lower(lifted).value).toEqual(bare);
  });

  it('a PtyInfo, through pty.list', () => {
    const info: PtyInfo = {
      ptyId: 'pty-1' as PtyInfo['ptyId'], appSessionId: 'app-1' as AppSessionId, label: 'shell', pid: 7, cwd: '/tmp', shell: '/bin/zsh',
      cols: 80, rows: 24, spawnedAt: '2026-09-28T00:00:00.000Z', alive: true, paused: false, exit: null, offset: 0,
    };
    const lifted = codecs.output('pty.list').lift({ ptys: [info] }, A);
    expect(lifted.ptys[0]).toMatchObject({ ptyId: at(A, 'pty-1'), appSessionId: at(A, 'app-1'), cwd: '/tmp' });
    const data = new Uint8Array([104, 105]);
    const chunk = codecs.event('pty.data').lift({ ptyId: 'pty-1' as PtyInfo['ptyId'], offset: 0, data }, A);
    expect(chunk.ptyId).toBe(at(A, 'pty-1'));
    expect(chunk.data).toBe(data); // the bytes are shared, never copied
  });

  it('a session.eventBatch, its side-thread events included', () => {
    const base = { sessionId: 'sess-1', at: '2026-09-28T10:00:00.000Z', agentId: null, parentToolUseId: null };
    const events = [
      SessionEventSchema.parse({ ...base, id: 'ev-1', seq: 1, kind: 'session.state', state: 'idle' }),
      SessionEventSchema.parse({ ...base, id: 'ev-2', seq: 2, kind: 'side.thread.opened', childAppSessionId: 'child-1', childEngineSessionId: null, anchor: null, openedBy: 'btw' }),
    ];
    const bare = { appSessionId: 'app-1' as AppSessionId, events };
    const lifted = codecs.event('session.eventBatch').lift(bare, A);
    expect(lifted.appSessionId).toBe(at(A, 'app-1'));
    expect(lifted.events[0]).toBe(events[0]); // an event with no id is shared as it is
    expect(lifted.events[1]).toMatchObject({ kind: 'side.thread.opened', childAppSessionId: at(A, 'child-1'), id: 'ev-2' }); // EventId is not lifted
    expect(codecs.event('session.eventBatch').lower(lifted).value).toEqual(bare);
  });
});
