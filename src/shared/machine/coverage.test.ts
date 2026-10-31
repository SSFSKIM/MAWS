// P5 Decision Log 21's condition on the address codec (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, M1,
// "Coverage"): every schema the renderer sends or receives holds its machine-bound ids in one of the four branded schemas
// the codec finds by identity, so no id crosses the boundary unaddressed. It fails on:
// - an object key named like a machine-bound id whose schema is not one of the four (the name rule);
// - a record keyed by a plain string that `REVIEWED_STRING_RECORDS` does not list with what its keys are;
// - a plain union whose options disagree (the compile step throws);
// - any difference from the committed snapshot of addressed paths, address-paths.json, which also catches a field the
//   name rule cannot see (an `id`, or one named by its role) re-typed as a plain string: its path vanishes. Rewrite the
//   snapshot with MAWS_ADDRESS_PATHS_WRITE=1 after reviewing its diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { AppSessionIdSchema, LooseAppSessionIdSchema, ProjectIdSchema } from '../graph/ids';
import { REGISTRY } from '../ipc/registry';
import { PtyIdSchema } from '../ipc/schema/pty';
import { addressedKindOf, addressedPaths, compileAddressing } from './address';

// ---- The walk ----------------------------------------------------------------------------------------------------------
// Paths as address.ts writes them: `.key`, `.*` (catchall), `[]`, `[n]`, `[...]`, `{key}`, `{}`, `<disc=a|b>`; a plain
// union's options share their path, as the codec merges them.
type Def = { type: string } & Record<string, unknown>;
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;
const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'nonoptional', 'readonly', 'catch']);

interface Visitor {
  property(key: string, schema: z.ZodType, path: string): void;
  record(keySchema: z.ZodType, path: string): void;
}

function walk(schema: z.ZodType, path: string, visitor: Visitor, onStack = new Set<z.ZodType>()): void {
  if (onStack.has(schema)) return;
  onStack.add(schema);
  const def = defOf(schema);
  const next = (child: z.ZodType, at: string) => walk(child, at, visitor, onStack);
  switch (def.type) {
    case 'object':
      for (const [key, child] of Object.entries(def.shape as Record<string, z.ZodType>)) {
        visitor.property(key, child, `${path}.${key}`);
        next(child, `${path}.${key}`);
      }
      if (def.catchall) next(def.catchall as z.ZodType, `${path}.*`);
      break;
    case 'array':
      next(def.element as z.ZodType, `${path}[]`);
      break;
    case 'tuple':
      (def.items as z.ZodType[]).forEach((child, index) => next(child, `${path}[${index}]`));
      if (def.rest) next(def.rest as z.ZodType, `${path}[...]`);
      break;
    case 'record':
      visitor.record(def.keyType as z.ZodType, path);
      next(def.keyType as z.ZodType, `${path}{key}`);
      next(def.valueType as z.ZodType, `${path}{}`);
      break;
    case 'union':
      for (const option of def.options as z.ZodType[]) {
        const disc = def.discriminator as string | undefined;
        const values = disc === undefined ? null : [...((option as unknown as { _zod: { propValues?: Record<string, Set<unknown>> } })._zod.propValues?.[disc] ?? [])];
        next(option, values === null ? path : `${path}<${disc}=${values.map(String).join('|')}>`);
      }
      break;
    case 'pipe':
      next(def.in as z.ZodType, path);
      next(def.out as z.ZodType, path);
      break;
    case 'lazy':
      next((schema as unknown as { _zod: { innerType: z.ZodType } })._zod.innerType, path);
      break;
    case 'intersection':
      next(def.left as z.ZodType, path);
      next(def.right as z.ZodType, path);
      break;
    default:
      if (WRAPPERS.has(def.type)) next(def.innerType as z.ZodType, path);
  }
  onStack.delete(schema);
}

// Every schema the renderer sends or receives, by its snapshot key.
function registrySchemas(): [string, z.ZodType][] {
  const out: [string, z.ZodType][] = [];
  for (const [name, spec] of Object.entries(REGISTRY.commands)) {
    out.push([`commands.${name}.input`, spec.input], [`commands.${name}.output`, spec.output]);
  }
  for (const [name, schema] of Object.entries(REGISTRY.events)) out.push([`events.${name}`, schema]);
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---- The name rule -----------------------------------------------------------------------------------------------------
const ID_NAMED = /^(?:appSessionIds?|appId|parentAppSessionId|projectIds?|ptyIds?|attentionIds?)$|(?:AppSessionId|ProjectId|PtyId|AttentionId)$/;

// One of the four (or a loose alias), possibly optional or nullable, or an array of them for a plural key; a union is
// branded when each of its options is, or is null.
function isBrandedId(schema: z.ZodType): boolean {
  if (addressedKindOf(schema)) return true;
  const def = defOf(schema);
  if (WRAPPERS.has(def.type)) return isBrandedId(def.innerType as z.ZodType);
  if (def.type === 'array') return isBrandedId(def.element as z.ZodType);
  if (def.type === 'lazy') return isBrandedId((schema as unknown as { _zod: { innerType: z.ZodType } })._zod.innerType);
  if (def.type === 'union') return (def.options as z.ZodType[]).every((option) => defOf(option).type === 'null' || isBrandedId(option));
  return false;
}

// The paths, under `root`, of keys named like a machine-bound id whose schema is not branded.
function unbrandedIdKeys(root: string, schema: z.ZodType): string[] {
  const found: string[] = [];
  walk(schema, root, {
    property: (key, child, path) => {
      if (ID_NAMED.test(key) && !isBrandedId(child)) found.push(path);
    },
    record: () => {},
  });
  return [...new Set(found)];
}

// ---- Records keyed by plain strings -------------------------------------------------------------------------------------
// Each record whose key schema is a plain string, by its path, with what its keys are. A record keyed by a machine-bound id
// takes a branded key schema instead (browser.tabs.list's `selected`).
const JSON_OBJECT = "a JSON object's member names (JsonValueSchema's object arm): free data, no id";
const ANSWERS = "a question's text → the answer chosen (question.answered)";
const MODEL_USAGE = "a model's name → its usage, as the engine reports it";
const MODEL_OVERRIDES = 'an ANTHROPIC_DEFAULT_*_MODEL variable → its value';
const ENGINE_JSON = "the engine's or the CLI's own JSON object: its keys are the engine's, no MAWS id";
const TOOL_ARGUMENTS = "a tool's argument names (its input schema's properties)";
const SPACE_SYSTEMS = 'a Space id (uuid) → its design system id';
const PASTED = "a paste placeholder's number, as a string (the terminal's key)";
const SURFACE_PROPS = "an engine surface's prop names";
const PINS = 'an engine session id → the account uuid it is pinned to';
const BRIDGE_CONTROLS = "a control's key in the bridge's capabilities.controls (desk-hub/protocol's CONTROL_KEYS)"; // P5 O9 M2
const REVIEWED_STRING_RECORDS: Readonly<Record<string, string>> = {
  'commands.artifacts.datasetRefreshRequest.output.request.args': TOOL_ARGUMENTS,
  'commands.artifacts.setDefaults.input.spaces': SPACE_SYSTEMS,
  'commands.artifacts.testWrite.input.ops[]<op=setAttr>.value': JSON_OBJECT,
  'commands.attention.request.output.event<kind=question.answered>.answers': ANSWERS,
  'commands.attention.request.output.event<kind=usage.sample>.modelUsage': MODEL_USAGE,
  'commands.browser.bookmarks.favicons.output.icons': 'a page origin → the favicon its pages last showed',
  'commands.connectors.call.output.result': JSON_OBJECT,
  'commands.connectors.directSend.input.arguments': TOOL_ARGUMENTS,
  'commands.connectors.directStart.input.arguments': TOOL_ARGUMENTS,
  'commands.connectors.directTake.output.outcome<kind=call>.outcome.result': JSON_OBJECT,
  'commands.connectors.start.input.arguments': TOOL_ARGUMENTS,
  'commands.connectors.take.output.outcome.result': JSON_OBJECT,
  'commands.engine.sessions.output[].modelOverrides': MODEL_OVERRIDES,
  'commands.fs.agentEvents.output.events[]<kind=question.answered>.answers': ANSWERS,
  'commands.fs.agentEvents.output.events[]<kind=usage.sample>.modelUsage': MODEL_USAGE,
  'commands.fs.tasks.output.tasks[].metadata': "a task's metadata, as the engine's task store writes it",
  'commands.host.op.input.input': JSON_OBJECT, // P5 O10 M7: an action's args (main-only, mawsd's ledger)
  'commands.laneA.list.output.states[].controls': BRIDGE_CONTROLS, // P5 O9 M2
  'commands.laneA.list.output.states[].pending[].input': TOOL_ARGUMENTS,
  'commands.laneA.read.input.args': "a bridge read's argument names (DX5 `read`'s args)",
  'commands.laneA.state.output.controls': BRIDGE_CONTROLS,
  'commands.laneA.state.output.pending[].input': TOOL_ARGUMENTS,
  'commands.machine.op.input.input': JSON_OBJECT, // P5 O3-D M1: a forwarded spine command's input (machine.op, main-only)
  'commands.machineSettings.get.output.settings.artifacts.spaceDesignSystems': SPACE_SYSTEMS, // P5 O3-D M1
  'commands.machineSettings.set.input.patch.artifacts.spaceDesignSystems': SPACE_SYSTEMS,
  'commands.machineSettings.set.output.settings.artifacts.spaceDesignSystems': SPACE_SYSTEMS,
  'commands.maws.artifact.exported.input.answer<ok=false>.refusal.data': "a refusal's detail fields (ArtifactRefusalSchema.data)",
  'commands.render.answer.input.answer<ok=false>.refusal.data': "a refusal's detail fields (ArtifactRefusalSchema.data), the render host's answer to the bridge's export (P5 O5 M3)",
  'commands.session.appEvents.output.events[]<kind=question.answered>.answers': ANSWERS,
  'commands.session.appEvents.output.events[]<kind=usage.sample>.modelUsage': MODEL_USAGE,
  'commands.session.applyFlagSettings.input.settings': "the engine's flag-settings keys",
  'commands.session.engineStatuses.output.statuses[].modelOverrides': MODEL_OVERRIDES,
  'commands.session.events.output.events[]<kind=question.answered>.answers': ANSWERS,
  'commands.session.events.output.events[]<kind=usage.sample>.modelUsage': MODEL_USAGE,
  'commands.session.events.output.cronHistory[]<kind=question.answered>.answers': ANSWERS,
  'commands.session.events.output.cronHistory[]<kind=usage.sample>.modelUsage': MODEL_USAGE,
  'commands.session.getSettings.output.effective': ENGINE_JSON,
  'commands.session.getSettings.output.applied': ENGINE_JSON,
  'commands.session.getUsage.output.session.model_usage': MODEL_USAGE,
  'commands.session.history.append.input.pastedContents': PASTED,
  'commands.session.history.list.output.entries[].pastedContents': PASTED,
  'commands.session.launch.input.spec.mcpConfig': ENGINE_JSON,
  'commands.session.launch.input.spec.extraSettings': ENGINE_JSON,
  'commands.session.launch.output<status=launching>.session.modelOverrides': MODEL_OVERRIDES,
  'commands.session.pendingRequest.output.event<kind=question.answered>.answers': ANSWERS,
  'commands.session.pendingRequest.output.event<kind=usage.sample>.modelUsage': MODEL_USAGE,
  'commands.session.status.output.modelOverrides': MODEL_OVERRIDES,
  'commands.session.ui.render.input.props': SURFACE_PROPS,
  'commands.session.ui.render.output.props': SURFACE_PROPS,
  'commands.settings.get.output.settings.artifacts.spaceDesignSystems': SPACE_SYSTEMS,
  'commands.settings.set.input.artifacts.spaceDesignSystems': SPACE_SYSTEMS,
  'commands.settings.set.output.settings.artifacts.spaceDesignSystems': SPACE_SYSTEMS,
  'commands.settings.usage.output.pinsFor': PINS,
  'events.connectors.watchUpdate.update.result': JSON_OBJECT,
  'events.laneA.changed.state.controls': BRIDGE_CONTROLS, // P5 O9 M2
  'events.laneA.changed.state.pending[].input': TOOL_ARGUMENTS,
  'events.machineSettings.changed.settings.artifacts.spaceDesignSystems': SPACE_SYSTEMS, // P5 O3-D M1
  'events.plugins.operation.outcome.result': ENGINE_JSON,
  'events.plugins.operation.outcome.error.shownCommand': ENGINE_JSON,
  'events.session.eventBatch.events[]<kind=question.answered>.answers': ANSWERS,
  'events.session.eventBatch.events[]<kind=usage.sample>.modelUsage': MODEL_USAGE,
  'events.session.status.status.modelOverrides': MODEL_OVERRIDES,
  'events.settings.changed.settings.artifacts.spaceDesignSystems': SPACE_SYSTEMS,
  'events.settings.usageChanged.pinsFor': PINS,
};

const isPlainString = (schema: z.ZodType): boolean => {
  const def = defOf(schema);
  if (WRAPPERS.has(def.type)) return isPlainString(def.innerType as z.ZodType);
  return def.type === 'string' && !addressedKindOf(schema);
};

function plainStringRecords(root: string, schema: z.ZodType): string[] {
  const found: string[] = [];
  walk(schema, root, {
    property: () => {},
    record: (keySchema, path) => {
      if (isPlainString(keySchema)) found.push(path);
    },
  });
  return [...new Set(found)];
}

// ---- The snapshot ------------------------------------------------------------------------------------------------------
const SNAPSHOT_PATH = fileURLToPath(new URL('./address-paths.json', import.meta.url));

// Inputs as the renderer lowers them; outputs and events as it lifts them.
function snapshotOf(): Record<string, string[]> {
  const snapshot: Record<string, string[]> = {};
  for (const [key, schema] of registrySchemas()) {
    const paths = addressedPaths(schema, key.endsWith('.input') ? 'lower' : 'lift');
    if (paths.length > 0) snapshot[key] = paths;
  }
  return snapshot;
}

// One entry per line, so a diff shows which entry changed.
const formatSnapshot = (snapshot: Record<string, string[]>): string =>
  `{\n${Object.entries(snapshot)
    .map(([key, paths]) => `${JSON.stringify(key)}:${JSON.stringify(paths)}`)
    .join(',\n')}\n}\n`;

// ---- The registry -------------------------------------------------------------------------------------------------------
describe("the registry's addressing coverage", () => {
  it('names no machine-bound id key whose schema is not branded', () => {
    expect(registrySchemas().flatMap(([key, schema]) => unbrandedIdKeys(key, schema))).toEqual([]);
  });

  it('keys no record by a plain string it has not reviewed, and reviews only records that exist', () => {
    const found = registrySchemas().flatMap(([key, schema]) => plainStringRecords(key, schema));
    expect(found.filter((path) => !Object.hasOwn(REVIEWED_STRING_RECORDS, path))).toEqual([]);
    expect(Object.keys(REVIEWED_STRING_RECORDS).filter((path) => !found.includes(path))).toEqual([]);
  });

  it('compiles every schema: no plain union disagrees', () => {
    for (const [key, schema] of registrySchemas()) expect(() => compileAddressing(schema), key).not.toThrow();
  });

  it('addresses exactly the committed paths (address-paths.json)', () => {
    const snapshot = snapshotOf();
    const current = formatSnapshot(snapshot);
    if (process.env.MAWS_ADDRESS_PATHS_WRITE === '1') writeFileSync(SNAPSHOT_PATH, current);
    let committed: string | null;
    try {
      committed = readFileSync(SNAPSHOT_PATH, 'utf8');
    } catch {
      committed = null;
    }
    expect(committed, 'no address-paths.json: review the paths and write it with MAWS_ADDRESS_PATHS_WRITE=1').not.toBeNull();
    // Each entry as one line, `<schema><path> <kind>`, so a failure names every path that vanished or appeared.
    const lines = (of: Record<string, string[]>) => new Set(Object.entries(of).flatMap(([key, paths]) => paths.map((path) => `${key}${path}`)));
    const was = lines(JSON.parse(committed!) as Record<string, string[]>);
    const now = lines(snapshot);
    const change = { vanished: [...was].filter((line) => !now.has(line)), appeared: [...now].filter((line) => !was.has(line)) };
    expect(change, 'the addressed paths changed: review them, then rewrite address-paths.json with MAWS_ADDRESS_PATHS_WRITE=1').toEqual({ vanished: [], appeared: [] });
    expect(current, 'address-paths.json is out of its written form: rewrite it with MAWS_ADDRESS_PATHS_WRITE=1').toBe(committed);
  });
});

// ---- The rules against fixture schemas ----------------------------------------------------------------------------------
describe('the rules, on fixture schemas', () => {
  it('an unbranded appSessionId field fails the name rule; a branded one passes', () => {
    expect(unbrandedIdKeys('fixture', z.strictObject({ appSessionId: z.string() }))).toEqual(['fixture.appSessionId']);
    expect(unbrandedIdKeys('fixture', z.strictObject({ appSessionId: AppSessionIdSchema }))).toEqual([]);
    expect(unbrandedIdKeys('fixture', z.strictObject({ appSessionId: LooseAppSessionIdSchema.nullable() }))).toEqual([]);
  });

  it('the name rule reads plural, suffixed and nested keys, and leaves other ids alone', () => {
    const schema = z.strictObject({
      projectIds: z.array(z.string()),
      list: z.array(z.strictObject({ ownerAppSessionId: z.string().optional(), ptyId: PtyIdSchema })),
      parentAppSessionId: z.union([AppSessionIdSchema, z.null()]),
      appId: z.string(),
      sessionId: z.string(), // the engine's: not machine-bound
      id: z.string(), // named by its role: the snapshot's to guard
      byProject: z.record(z.string(), z.strictObject({ projectId: ProjectIdSchema })),
    });
    expect(unbrandedIdKeys('f', schema).sort()).toEqual(['f.appId', 'f.list[].ownerAppSessionId', 'f.projectIds']);
  });

  it('a record keyed by a plain string is found, and one keyed by a branded id or an enum is not', () => {
    const schema = z.strictObject({
      bySession: z.record(AppSessionIdSchema, z.number()),
      byName: z.record(z.string(), z.number()),
      byKind: z.record(z.enum(['a', 'b']), z.number()),
      nested: z.array(z.strictObject({ inner: z.record(z.string().min(1), z.string()) })),
    });
    expect(plainStringRecords('f', schema)).toEqual(['f.byName', 'f.nested[].inner']);
  });

  it('a field re-typed from an id to a plain string vanishes from the addressed paths', () => {
    expect(addressedPaths(z.strictObject({ id: ProjectIdSchema, name: z.string() }), 'lift')).toEqual(['.id ProjectId']);
    expect(addressedPaths(z.strictObject({ id: z.string(), name: z.string() }), 'lift')).toEqual([]);
  });
});
