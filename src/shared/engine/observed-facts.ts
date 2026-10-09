// X17 — observed facts (P2-A execution document §5.5; the P2 spec §4.2): what the engine last reported for a session,
// each fact with the journal time and the launch it came from, so a surface can say "Loaded last time, 2 days ago"
// against "Loaded now" and never show an unknown as empty. The engine host writes and recovers the file
// `<userData>/engine-host/state/<appSessionId>.observed.json` beside the state file (never a key in it); main relays it
// as `session.observedFacts`. The reader is tolerant on purpose: the owner's development and packaged builds share one
// `userData`, so a file may come from a newer build, and it holds nothing irreplaceable.
import * as z from 'zod';
import { PermissionModeSchema } from '../graph/enums';
import { AppSessionIdSchema, type AppSessionId } from '../graph/ids';
import { EffortSchema } from './launch-spec';

// A fact: its value, when the engine said it (the journal row's time), and the launch it said it in. null: unknown.
// The facts' shapes drop keys they do not know (z.object) rather than refuse them, so a newer build's addition inside a
// fact never turns it unknown here.
const fact = <T extends z.ZodType>(value: T) => z.object({ value, at: z.string(), launchId: z.string() });
export type Fact<T> = { value: T; at: string; launchId: string } | null;

export const ObservedPluginSchema = z.object({ name: z.string(), path: z.string(), source: z.string().nullable(), version: z.string().nullable() });
export const ObservedPluginErrorSchema = z.object({ plugin: z.string(), type: z.string(), message: z.string(), path: z.string().nullable() });
export const ObservedPluginWarningSchema = z.object({ plugin: z.string(), type: z.string(), message: z.string() });
export type ObservedPlugin = z.infer<typeof ObservedPluginSchema>;
export type ObservedPluginError = z.infer<typeof ObservedPluginErrorSchema>;
export type ObservedPluginWarning = z.infer<typeof ObservedPluginWarningSchema>;
export const ObservedPluginsSchema = z.object({ plugins: z.array(ObservedPluginSchema), errors: z.array(ObservedPluginErrorSchema), warnings: z.array(ObservedPluginWarningSchema) });
export type ObservedPlugins = z.infer<typeof ObservedPluginsSchema>;
// a get_context_usage answer, mapped as the digest's context is (src/main/sessions/digest.ts, `context.sample`)
export const ObservedContextUsageSchema = z.object({ percent: z.number(), totalTokens: z.number().int(), maxTokens: z.number().int(), autoCompactThreshold: z.number().int().nullable() });
export type ObservedContextUsage = z.infer<typeof ObservedContextUsageSchema>;

// The fact fields, each parsed on its own by the reader.
const FACT_SHAPES = {
  engineVersion: fact(z.string()), // system/init claude_code_version
  model: fact(z.string()), // system/init model (the resolved id)
  effort: fact(EffortSchema), // a get_settings answer's applied.effort
  mode: fact(PermissionModeSchema), // the effective mode: initialize, system/init, system/status, a set_permission_mode answer
  outputStyle: fact(z.string()), // initialize's and system/init's output_style
  plugins: fact(ObservedPluginsSchema), // system/init, or a successful reload_plugins (keeping the last init's errors and warnings)
  contextUsage: fact(ObservedContextUsageSchema), // a get_context_usage answer
} as const;
export const OBSERVED_FACT_KEYS = Object.keys(FACT_SHAPES) as (keyof typeof FACT_SHAPES)[];
export type ObservedFactKey = (typeof OBSERVED_FACT_KEYS)[number];

export const ObservedFactsSchema = z.strictObject({
  version: z.literal(1),
  appSessionId: AppSessionIdSchema,
  engineSessionId: z.string().nullable(),
  writtenAt: z.string(),
  source: z.enum(['live', 'journal']), // how the file was last written
  launches: z.array(z.string()), // the launch ids folded in (live or recovered)
  engineVersion: FACT_SHAPES.engineVersion.nullable(),
  model: FACT_SHAPES.model.nullable(),
  effort: FACT_SHAPES.effort.nullable(),
  mode: FACT_SHAPES.mode.nullable(),
  outputStyle: FACT_SHAPES.outputStyle.nullable(),
  plugins: FACT_SHAPES.plugins.nullable(),
  contextUsage: FACT_SHAPES.contextUsage.nullable(),
});
export type ObservedFacts = z.infer<typeof ObservedFactsSchema>;

// The wire answer of `engine.observedFacts` and `session.observedFacts`: the facts, and whether recovery read every
// launch it knows of (false when its reading budget ran out; the rest is folded at the next read). Never in the file.
export const ObservedFactsAnswerSchema = ObservedFactsSchema.extend({ complete: z.boolean() });
export type ObservedFactsAnswer = z.infer<typeof ObservedFactsAnswerSchema>;

export function emptyObservedFacts(appSessionId: AppSessionId, writtenAt: string, source: ObservedFacts['source']): ObservedFacts {
  return { version: 1, appSessionId, engineSessionId: null, writtenAt, source, launches: [], engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: null, contextUsage: null };
}

const strip = <T>(schema: z.ZodType<T>, value: unknown): T | null => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

// The file as this build reads it, whatever build wrote it: each fact parses on its own and one that fails reads as
// unknown; unknown keys are dropped; a higher version reads the same way (fields are additive by rule). null for text
// that is not JSON or names no session (a truncated or foreign file), which the caller leaves where it is.
export function readObservedFacts(text: string): ObservedFacts | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const file = raw as Record<string, unknown>;
  const appSessionId = AppSessionIdSchema.safeParse(file.appSessionId);
  if (!appSessionId.success) return null;
  const base = emptyObservedFacts(appSessionId.data, typeof file.writtenAt === 'string' ? file.writtenAt : '', file.source === 'journal' ? 'journal' : 'live');
  const facts: ObservedFacts = {
    ...base,
    engineSessionId: typeof file.engineSessionId === 'string' ? file.engineSessionId : null,
    launches: Array.isArray(file.launches) ? file.launches.filter((l): l is string => typeof l === 'string') : [],
  };
  for (const key of OBSERVED_FACT_KEYS) (facts as Record<ObservedFactKey, unknown>)[key] = strip(FACT_SHAPES[key] as z.ZodType<unknown>, file[key]);
  return facts;
}

const later = <T>(a: Fact<T>, b: Fact<T>): Fact<T> => {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b.at) >= Date.parse(a.at) ? b : a;
};

// Per field, the later `at` wins (a tie goes to `b`, the newer write), so a launch that observed nothing keeps the
// previous launch's fact and the order of live writes and recovery never matters; `launches` are united; the file's
// own bookkeeping (writtenAt, source) is `b`'s, the write being made.
export function mergeObservedFacts(a: ObservedFacts, b: ObservedFacts): ObservedFacts {
  const merged: ObservedFacts = { ...b, engineSessionId: b.engineSessionId ?? a.engineSessionId, launches: [...new Set([...a.launches, ...b.launches])] };
  for (const key of OBSERVED_FACT_KEYS) (merged as Record<ObservedFactKey, Fact<unknown>>)[key] = later<unknown>(a[key], b[key]);
  return merged;
}

// A context sample (the normaliser's `context.sample` fields) as the digest's context: tokens rounded, and no threshold
// when the engine reports autocompact off (debt wave 4).
export function contextUsageOf(sample: { percentage: number; totalTokens: number; maxTokens: number; autoCompactThreshold: number | null; isAutoCompactEnabled: boolean }): ObservedContextUsage {
  return {
    percent: sample.percentage,
    totalTokens: Math.round(sample.totalTokens),
    maxTokens: Math.round(sample.maxTokens),
    autoCompactThreshold: !sample.isAutoCompactEnabled || sample.autoCompactThreshold === null ? null : Math.round(sample.autoCompactThreshold),
  };
}
