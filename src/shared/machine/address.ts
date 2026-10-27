// The one codec for addresses (P5 OX2, Decision Logs 21 and 22; docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md,
// M1). An address is `<ref>/<bare>`: a machine's `MachineRef`, the first `/`, then the id that machine alone resolves (which
// may itself hold a `/`). A ref has no `/` (ref.ts), so the split is unambiguous. This module is the only one that joins
// or splits an address; everything else goes through `addressOf`, `machineOf`, `bareOf` and `isAddress`.
//
// Four id kinds are machine-bound and lifted: `AppSessionId`, `ProjectId`, `PtyId` and `AttentionId` (`ADDRESSED_SCHEMAS`,
// found by schema identity: a brand is type-only, so every field of a kind reuses one schema instance, or one of its loose
// aliases). The engine's `SessionId`, `EventId`, within-session ids and artifact ids are not lifted (M1, "What is lifted").
//
// `compileAddressing(schema)` walks a zod 4 schema's definition tree once and returns a lifter and a lowerer, each running
// a precomputed plan of where the four kinds occur, so an id-free branch costs nothing at run time. The walk follows
// object properties and catchalls, array and tuple elements, record keys and values, the optional, nullable, default,
// prefault, nonoptional, readonly and catch wrappers, a pipe's input side for lowering and its output side for lifting,
// `lazy` (a recursive schema compiles to a cyclic plan), discriminated unions (dispatched by the discriminator) and plain
// unions. A plain union's options are merged: a key is rewritten at a path when every option that applies there (an
// object's property or else its catchall, a record's value, a tuple's item or else its rest, an array's element) says it
// is one of the four kinds, and options that disagree (an id in one; a plain string, or any value the walk cannot classify,
// in another) throw at compile, naming the path. Any other construct that would hide an id (an intersection, a map, a set,
// a promise, a transform the walk cannot see through) throws at compile too, so nothing is skipped quietly.
import type * as z from 'zod';
import { AppSessionIdSchema, AttentionIdSchema, LooseAppSessionIdSchema, ProjectIdSchema } from '../graph/ids';
import type { WireRegistry } from '../ipc/registry';
import { PtyIdSchema } from '../ipc/schema/pty';
import type { MachineRef } from './ref';

export const ADDRESS_SEPARATOR = '/';

const REF = /^[A-Za-z0-9_-]{16,64}$/; // MachineRefSchema's pattern (ref.ts), tested without a parse on the hot path

export type AddressedKind = 'AppSessionId' | 'ProjectId' | 'PtyId' | 'AttentionId';

// The canonical instances and their loose aliases (src/shared/graph/ids.ts), each with its kind.
const KIND_OF = new Map<z.ZodType, AddressedKind>([
  [AppSessionIdSchema, 'AppSessionId'],
  [LooseAppSessionIdSchema, 'AppSessionId'],
  [ProjectIdSchema, 'ProjectId'],
  [PtyIdSchema, 'PtyId'],
  [AttentionIdSchema, 'AttentionId'],
]);
export const ADDRESSED_SCHEMAS: readonly z.ZodType[] = [...KIND_OF.keys()];
export const addressedKindOf = (schema: z.ZodType): AddressedKind | undefined => KIND_OF.get(schema);

// `${machine}/${bare}`, typed as the id it addresses. Throws on a machine that is not a ref, or an empty id.
export function addressOf<T extends string>(machine: MachineRef, bare: T): T {
  if (!REF.test(machine)) throw new Error(`not a machine ref: ${JSON.stringify(machine)}`);
  if (bare.length === 0) throw new Error('an address needs a non-empty id');
  return `${machine}${ADDRESS_SEPARATOR}${bare}` as T;
}

// A valid MachineRef, then '/', then at least one character.
export function isAddress(value: string): boolean {
  const at = value.indexOf(ADDRESS_SEPARATOR);
  return at > 0 && at < value.length - 1 && REF.test(value.slice(0, at));
}

export function machineOf(address: string): MachineRef {
  if (!isAddress(address)) throw new Error(`not an address: ${JSON.stringify(address)}`);
  return address.slice(0, address.indexOf(ADDRESS_SEPARATOR)) as MachineRef;
}

export function bareOf<T extends string>(address: T): T {
  if (!isAddress(address)) throw new Error(`not an address: ${JSON.stringify(address)}`);
  return address.slice(address.indexOf(ADDRESS_SEPARATOR) + 1) as T;
}

export interface Addressing {
  lift<T>(value: T, machine: MachineRef): T; // throws on an address already present
  lower<T>(value: T): { value: T; machines: ReadonlySet<MachineRef> }; // throws on a bare id where an address belongs
}

// ---- The plan --------------------------------------------------------------------------------------------------------
// A plan says where the ids are in a value of one schema; `null` is the identity. An id node keeps its path, for the
// errors and for `addressedPaths`. Path syntax: `.key` a property, `.*` an object's catchall, `[]` an array's element, `[n]`
// a tuple item and `[...]` its rest, `{key}` a record's key and `{}` its value, `<disc=a|b>` a discriminated union's option.
type IdPlan = { readonly k: 'id'; readonly path: string; readonly kinds: readonly AddressedKind[] };
type Plan =
  | IdPlan
  | { readonly k: 'object'; readonly props: readonly (readonly [string, Plan])[]; readonly known: ReadonlySet<string>; readonly catchall: Plan | null }
  | { readonly k: 'array'; readonly element: Plan }
  | { readonly k: 'tuple'; readonly items: readonly (Plan | null)[]; readonly rest: Plan | null }
  | { readonly k: 'record'; readonly key: IdPlan | null; readonly value: Plan | null }
  | { readonly k: 'dunion'; readonly discriminator: string; readonly options: ReadonlyMap<unknown, Plan | null> }
  | { readonly k: 'byType'; readonly string: Plan | null; readonly object: Plan | null; readonly array: Plan | null } // a plain union's runtime kinds
  | { readonly k: 'ref'; readonly cell: { plan: Plan | null } }; // a lazy schema's recursion

type Direction = 'lift' | 'lower';
type Def = { type: string } & Record<string, unknown>;
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;
const lazyInner = (schema: z.ZodType): z.ZodType => (schema as unknown as { _zod: { innerType: z.ZodType } })._zod.innerType;
const propValues = (schema: z.ZodType, key: string): ReadonlySet<unknown> | undefined =>
  (schema as unknown as { _zod: { propValues?: Record<string, ReadonlySet<unknown>> } })._zod.propValues?.[key];
const shown = (path: string) => (path === '' ? 'the value itself' : path);

const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'nonoptional', 'readonly', 'catch']);
const STRINGISH = new Set(['string', 'enum', 'literal', 'template_literal']);
const UNWALKED = new Set(['intersection', 'map', 'set', 'promise']);
const STRUCTURAL = new Set([...STRINGISH, 'object', 'record', 'array', 'tuple', 'union']);
// Values that are never a string, an object or an array at run time: beside an id they can be told apart by type.
const PRIMITIVE = new Set(['null', 'undefined', 'void', 'never', 'number', 'int', 'boolean', 'bigint', 'symbol', 'nan']);
// Opaque: every member the walk does not classify (unknown, any, custom, a transform, an id-free intersection, map, set,
// promise, date, file...). Inside a plain union that carries an id, it may accept what another option says is an id, and
// says nothing itself, so agreement cannot be established.
const isOpaque = (schema: z.ZodType): boolean => !KIND_OF.has(schema) && !STRUCTURAL.has(defOf(schema).type) && !PRIMITIVE.has(defOf(schema).type);

// The schemas directly under `schema`, for the reachability pass (a pipe's both sides: an id behind an opaque side must
// still be seen, to be refused).
function childrenOf(schema: z.ZodType): z.ZodType[] {
  const def = defOf(schema);
  switch (def.type) {
    case 'object': {
      const shape = Object.values(def.shape as Record<string, z.ZodType>);
      return def.catchall ? [...shape, def.catchall as z.ZodType] : shape;
    }
    case 'array':
      return [def.element as z.ZodType];
    case 'tuple':
      return [...(def.items as z.ZodType[]), ...(def.rest ? [def.rest as z.ZodType] : [])];
    case 'record':
    case 'map':
      return [def.keyType as z.ZodType, def.valueType as z.ZodType];
    case 'union':
      return [...(def.options as z.ZodType[])];
    case 'intersection':
      return [def.left as z.ZodType, def.right as z.ZodType];
    case 'pipe':
      return [def.in as z.ZodType, def.out as z.ZodType];
    case 'lazy':
      return [lazyInner(schema)];
    case 'set':
      return [def.valueType as z.ZodType];
    case 'promise':
      return [def.innerType as z.ZodType];
    default:
      return WRAPPERS.has(def.type) ? [def.innerType as z.ZodType] : [];
  }
}

// Does an id of the four kinds occur anywhere under `schema`? Memoised; a false that leaned on a schema still being
// visited (a cycle) is not cached, since the rest of the cycle may yet overturn it.
const reaches = new WeakMap<z.ZodType, boolean>();
function reachesId(schema: z.ZodType, visiting: Set<z.ZodType>): { yes: boolean; provisional: boolean } {
  if (KIND_OF.has(schema)) return { yes: true, provisional: false };
  const known = reaches.get(schema);
  if (known !== undefined) return { yes: known, provisional: false };
  if (visiting.has(schema)) return { yes: false, provisional: true };
  visiting.add(schema);
  let yes = false;
  let provisional = false;
  for (const child of childrenOf(schema)) {
    const result = reachesId(child, visiting);
    if (result.yes) {
      yes = true;
      break;
    }
    provisional ||= result.provisional;
  }
  visiting.delete(schema);
  if (yes || !provisional) reaches.set(schema, yes);
  return { yes, provisional: !yes && provisional };
}
const carriesId = (schema: z.ZodType): boolean => reachesId(schema, new Set()).yes;

class Compiler {
  private readonly open = new Map<string, { plan: Plan | null }>();
  private readonly ids = new Map<z.ZodType, number>();

  constructor(private readonly dir: Direction) {}

  // The plan for a value matching any of `schemas` at `path` (one schema, or a plain union's options). Only the sets being
  // compiled on the current branch are kept, so a lazy schema met again inside itself becomes a reference to its own plan
  // (a cycle), and a schema shared by two paths is compiled at each, each with its own paths.
  // Every member is kept, an id-free one included: a plain string beside an id is a disagreement to refuse.
  plan(schemas: readonly z.ZodType[], path: string): Plan | null {
    if (!schemas.some(carriesId)) return null;
    const key = schemas
      .map((schema) => this.idOf(schema))
      .sort((a, b) => a - b)
      .join(',');
    const open = this.open.get(key);
    if (open) return { k: 'ref', cell: open };
    const cell = { plan: null as Plan | null };
    this.open.set(key, cell);
    try {
      cell.plan = this.build(schemas, path);
    } finally {
      this.open.delete(key);
    }
    return cell.plan;
  }

  private idOf(schema: z.ZodType): number {
    let id = this.ids.get(schema);
    if (id === undefined) {
      id = this.ids.size;
      this.ids.set(schema, id);
    }
    return id;
  }

  // Unwraps every member to what a value of it is at run time (an id, a plain string, an object, a record, an array, a
  // tuple, a discriminated union, or something holding no id), flattening plain unions into the set.
  private expand(schemas: readonly z.ZodType[], path: string): z.ZodType[] {
    const out: z.ZodType[] = [];
    const visit = (schema: z.ZodType): void => {
      const def = defOf(schema);
      if (KIND_OF.has(schema)) {
        out.push(schema);
      } else if (WRAPPERS.has(def.type)) {
        visit(def.innerType as z.ZodType);
      } else if (def.type === 'lazy') {
        visit(lazyInner(schema));
      } else if (def.type === 'pipe') {
        const [side, other] = this.dir === 'lower' ? [def.in as z.ZodType, def.out as z.ZodType] : [def.out as z.ZodType, def.in as z.ZodType];
        if (defOf(side).type === 'transform' && carriesId(other)) throw new Error(`${shown(path)}: an id sits behind a transform, where addressing cannot follow it`);
        visit(side);
      } else if (def.type === 'union' && def.discriminator === undefined) {
        (def.options as z.ZodType[]).forEach(visit);
      } else if (UNWALKED.has(def.type) && carriesId(schema)) {
        throw new Error(`${shown(path)}: an id inside a ${def.type}, which addressing does not walk`);
      } else {
        out.push(schema);
      }
    };
    schemas.forEach(visit);
    return out;
  }

  private build(schemas: readonly z.ZodType[], path: string): Plan | null {
    const expanded = this.expand(schemas, path);
    let opaque = expanded.some(isOpaque);
    // A member that is no string, object or array (a null, a number) holds no id, and leaves a lone discriminated union
    // beside it dispatched.
    const structural = expanded.filter((schema) => KIND_OF.has(schema) || STRUCTURAL.has(defOf(schema).type));
    if (!opaque && structural.length === 1 && defOf(structural[0]).type === 'union') return this.dispatched(structural[0], path);
    // Beside other members, a discriminated union's options join the plain merge.
    const members: z.ZodType[] = [];
    const flatten = (schema: z.ZodType): void => {
      if (defOf(schema).type === 'union') this.expand(defOf(schema).options as z.ZodType[], path).forEach(flatten);
      else if (isOpaque(schema)) opaque = true;
      else members.push(schema);
    };
    structural.forEach(flatten);
    // An unknown, any or custom member accepts what another says is an id, and says nothing itself: no agreement.
    if (opaque && members.some(carriesId)) throw new Error(`${shown(path)}: a union's options disagree, an id in one and an opaque value, which the walk cannot see into, in another`);

    const kinds = new Set<AddressedKind>();
    let plainString = false;
    const objects: z.ZodType[] = [];
    const records: z.ZodType[] = [];
    const arrays: z.ZodType[] = [];
    const tuples: z.ZodType[] = [];
    for (const schema of members) {
      const kind = KIND_OF.get(schema);
      const type = defOf(schema).type;
      if (kind) kinds.add(kind);
      else if (STRINGISH.has(type)) plainString = true;
      else if (type === 'object') objects.push(schema);
      else if (type === 'record') records.push(schema);
      else if (type === 'array') arrays.push(schema);
      else if (type === 'tuple') tuples.push(schema);
    }
    if (kinds.size > 0 && plainString) throw new Error(`${shown(path)}: a union's options disagree, an id in one and a plain string in another`);
    const string: Plan | null = kinds.size > 0 ? { k: 'id', path, kinds: [...kinds].sort() } : null;
    const objectLike = this.objectLikePlan(objects, records, path);
    const arrayLike = this.arrayLikePlan(arrays, tuples, path);
    const present = [string, objectLike, arrayLike].filter((plan) => plan !== null);
    if (present.length === 0) return null;
    if (present.length === 1) return present[0];
    return { k: 'byType', string, object: objectLike, array: arrayLike };
  }

  private dispatched(union: z.ZodType, path: string): Plan | null {
    const def = defOf(union);
    const discriminator = def.discriminator as string;
    const options = new Map<unknown, Plan | null>();
    let any = false;
    for (const option of def.options as z.ZodType[]) {
      const values = [...(propValues(option, discriminator) ?? [])];
      const plan = this.plan([option], `${path}<${discriminator}=${values.map(String).join('|')}>`);
      any ||= plan !== null;
      for (const value of values) options.set(value, plan);
    }
    return any ? { k: 'dunion', discriminator, options } : null;
  }

  // Objects and records alike are plain objects at run time, so every option that applies at a key is compared there: an
  // object's declared property, else its catchall (a strict object's `never` applies nowhere), and every record's value.
  // A record keyed by ids beside an object cannot be told from it, since the object's property names are no ids.
  private objectLikePlan(objects: readonly z.ZodType[], records: readonly z.ZodType[], path: string): Plan | null {
    if (objects.length === 0 && records.length === 0) return null;
    const key = records.length === 0 ? null : this.plan(records.map((record) => defOf(record).keyType as z.ZodType), `${path}{key}`);
    if (key && key.k !== 'id') throw new Error(`${shown(path)}: a record key that is not a plain id`);
    const values = records.map((record) => defOf(record).valueType as z.ZodType);
    if (objects.length === 0) {
      const value = this.plan(values, `${path}{}`);
      return key || value ? { k: 'record', key, value } : null;
    }
    if (key) throw new Error(`${shown(path)}: a union's options disagree, a record keyed by ids in one and an object, whose property names are no ids, in another`);
    const shapeOf = (object: z.ZodType) => defOf(object).shape as Record<string, z.ZodType>;
    const catchallOf = (object: z.ZodType): z.ZodType[] => {
      const catchall = defOf(object).catchall as z.ZodType | undefined;
      return catchall && defOf(catchall).type !== 'never' ? [catchall] : [];
    };
    const keys = new Set(objects.flatMap((object) => Object.keys(shapeOf(object))));
    const props: [string, Plan][] = [];
    for (const name of keys) {
      const applying = [...objects.flatMap((object) => (Object.hasOwn(shapeOf(object), name) ? [shapeOf(object)[name]] : catchallOf(object))), ...values];
      const plan = this.plan(applying, `${path}.${name}`);
      if (plan) props.push([name, plan]);
    }
    const catchall = this.plan([...objects.flatMap(catchallOf), ...values], `${path}.*`);
    if (props.length === 0 && !catchall) return null;
    return { k: 'object', props, known: keys, catchall };
  }

  // Arrays and tuples alike are arrays at run time: at each index every option that applies is compared, a tuple's item
  // there, else its rest, and every array's element.
  private arrayLikePlan(arrays: readonly z.ZodType[], tuples: readonly z.ZodType[], path: string): Plan | null {
    if (arrays.length === 0 && tuples.length === 0) return null;
    const restOf = (tuple: z.ZodType): z.ZodType[] => (defOf(tuple).rest ? [defOf(tuple).rest as z.ZodType] : []);
    const elements = arrays.map((array) => defOf(array).element as z.ZodType);
    const rests = [...elements, ...tuples.flatMap(restOf)];
    if (tuples.length === 0) {
      const element = this.plan(rests, `${path}[]`);
      return element ? { k: 'array', element } : null;
    }
    const itemsOf = (tuple: z.ZodType) => defOf(tuple).items as z.ZodType[];
    const width = Math.max(...tuples.map((tuple) => itemsOf(tuple).length));
    const items: (Plan | null)[] = [];
    for (let index = 0; index < width; index++) {
      const applying = [...tuples.flatMap((tuple) => (index < itemsOf(tuple).length ? [itemsOf(tuple)[index]] : restOf(tuple))), ...elements];
      items.push(this.plan(applying, `${path}[${index}]`));
    }
    const rest = this.plan(rests, `${path}[...]`);
    return items.some((item) => item !== null) || rest ? { k: 'tuple', items, rest } : null;
  }
}

// ---- Running a plan --------------------------------------------------------------------------------------------------
// A run copies along the paths it changes and shares every untouched subtree.
type Rewrite = (id: string, plan: IdPlan) => string;

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Sets an own property on a copy, `__proto__` included.
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

function run(plan: Plan | null, value: unknown, rewrite: Rewrite): unknown {
  if (plan === null || value === null || value === undefined) return value;
  switch (plan.k) {
    case 'ref':
      return run(plan.cell.plan, value, rewrite);
    case 'id':
      return typeof value === 'string' ? rewrite(value, plan) : value;
    case 'byType':
      if (typeof value === 'string') return run(plan.string, value, rewrite);
      return run(Array.isArray(value) ? plan.array : plan.object, value, rewrite);
    case 'dunion':
      return isPlainObject(value) ? run(plan.options.get(value[plan.discriminator]) ?? null, value, rewrite) : value;
    case 'object': {
      if (!isPlainObject(value)) return value;
      let copy: Record<string, unknown> | null = null;
      for (const [key, sub] of plan.props) {
        if (!Object.hasOwn(value, key)) continue;
        const next = run(sub, value[key], rewrite);
        if (next !== value[key]) setOwn((copy ??= { ...value }), key, next);
      }
      if (plan.catchall) {
        for (const key of Object.keys(value)) {
          if (plan.known.has(key)) continue;
          const next = run(plan.catchall, value[key], rewrite);
          if (next !== value[key]) setOwn((copy ??= { ...value }), key, next);
        }
      }
      return copy ?? value;
    }
    case 'record': {
      if (!isPlainObject(value)) return value;
      let changed = false;
      const copy: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        const nextKey = plan.key ? rewrite(key, plan.key) : key;
        const next = run(plan.value, value[key], rewrite);
        changed ||= nextKey !== key || next !== value[key];
        setOwn(copy, nextKey, next);
      }
      return changed ? copy : value;
    }
    case 'array':
    case 'tuple': {
      if (!Array.isArray(value)) return value;
      let copy: unknown[] | null = null;
      for (let index = 0; index < value.length; index++) {
        const sub = plan.k === 'array' ? plan.element : index < plan.items.length ? plan.items[index] : plan.rest;
        const next = run(sub, value[index], rewrite);
        if (next !== value[index]) (copy ??= [...value])[index] = next;
      }
      return copy ?? value;
    }
  }
}

function addressingOver(liftPlan: Plan | null, lowerPlan: Plan | null): Addressing {
  return {
    lift<T>(value: T, machine: MachineRef): T {
      if (liftPlan === null) return value;
      if (!REF.test(machine)) throw new Error(`lift: not a machine ref: ${JSON.stringify(machine)}`);
      return run(liftPlan, value, (id, plan) => {
        if (isAddress(id)) throw new Error(`lift: ${shown(plan.path)} already holds an address, ${JSON.stringify(id)}`);
        if (id.length === 0) throw new Error(`lift: ${shown(plan.path)} holds an empty id, which no address can carry`);
        return addressOf(machine, id);
      }) as T;
    },
    lower<T>(value: T): { value: T; machines: ReadonlySet<MachineRef> } {
      const machines = new Set<MachineRef>();
      if (lowerPlan === null) return { value, machines };
      const lowered = run(lowerPlan, value, (address, plan) => {
        if (!isAddress(address)) throw new Error(`lower: ${shown(plan.path)} holds a bare id where an address belongs, ${JSON.stringify(address)}`);
        const at = address.indexOf(ADDRESS_SEPARATOR);
        machines.add(address.slice(0, at) as MachineRef);
        return address.slice(at + 1);
      }) as T;
      return { value: lowered, machines };
    },
  };
}

// Throws on a plain union whose options disagree, or on an id addressing cannot walk to.
export function compileAddressing(schema: z.ZodType): Addressing {
  return addressingOver(new Compiler('lift').plan([schema], ''), new Compiler('lower').plan([schema], ''));
}

// Every path at which one of the four kinds is rewritten in `direction`, each with its kinds, sorted: the coverage test's
// snapshot (src/shared/machine/address-paths.json). A recursive branch is listed once, at its first depth.
export function addressedPaths(schema: z.ZodType, direction: Direction): string[] {
  const out = new Set<string>();
  const seen = new Set<Plan>();
  const visit = (plan: Plan | null): void => {
    if (plan === null || seen.has(plan)) return;
    seen.add(plan);
    switch (plan.k) {
      case 'id':
        out.add(`${plan.path} ${plan.kinds.join('|')}`);
        return;
      case 'ref':
        return visit(plan.cell.plan);
      case 'byType':
        return [plan.string, plan.object, plan.array].forEach(visit);
      case 'dunion':
        return [...plan.options.values()].forEach(visit);
      case 'object':
        plan.props.forEach(([, sub]) => visit(sub));
        return visit(plan.catchall);
      case 'record':
        visit(plan.key);
        return visit(plan.value);
      case 'array':
        return visit(plan.element);
      case 'tuple':
        plan.items.forEach(visit);
        return visit(plan.rest);
    }
  };
  visit(new Compiler(direction).plan([schema], ''));
  return [...out].sort();
}

// The registry's codecs, each compiled on first use and kept.
export function addressingOf(registry: WireRegistry): { input(name: string): Addressing; output(name: string): Addressing; event(name: string): Addressing } {
  const cache = new Map<string, Addressing>();
  const of = (key: string, schema: z.ZodType | undefined): Addressing => {
    let addressing = cache.get(key);
    if (!addressing) {
      if (!schema) throw new Error(`no schema is registered for ${key}`);
      addressing = compileAddressing(schema);
      cache.set(key, addressing);
    }
    return addressing;
  };
  const command = (name: string) => (Object.hasOwn(registry.commands, name) ? registry.commands[name] : undefined);
  return {
    input: (name) => of(`commands.${name}.input`, command(name)?.input),
    output: (name) => of(`commands.${name}.output`, command(name)?.output),
    event: (name) => of(`events.${name}`, Object.hasOwn(registry.events, name) ? registry.events[name] : undefined),
  };
}
