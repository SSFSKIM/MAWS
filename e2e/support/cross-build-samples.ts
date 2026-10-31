// The cross-build group's command samples (e2e/cross-build.spec.ts): an input for each command a newer build's window can
// send, from the wire manifest's JSON Schema (`sampleOf`), or named in INPUTS where the sampler's guess is refused by the
// schema's own refinements (test/support/cross-build-samples.test.ts holds every sample to the registry's validation).
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---- JSON Schema, as the manifest renders the wire (z.toJSONSchema) ---------------------------------------------------

export type Schema = Record<string, unknown>;
export const isSchema = (value: unknown): value is Schema => typeof value === 'object' && value !== null && !Array.isArray(value);
function deref(schema: unknown, root: unknown): unknown {
  if (!isSchema(schema) || typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) return schema;
  return deref(schema.$ref.slice(2).split('/').reduce<unknown>((at, key) => (isSchema(at) ? at[key] : undefined), root), root);
}

// A value `schema` accepts, for a command's input: the first of every choice, each required property, the least of
// every bound. A pattern or a format it does not know may defeat it; INPUTS then names that command's input.
export function sampleOf(schema: unknown, root: unknown = schema): unknown {
  const s = deref(schema, root);
  if (!isSchema(s)) return undefined;
  if ('const' in s) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  for (const choice of [s.anyOf, s.oneOf, s.allOf]) if (Array.isArray(choice)) return sampleOf(choice[0], root);
  const type = Array.isArray(s.type) ? (s.type.includes('null') ? 'null' : s.type[0]) : s.type;
  if (type === 'object') {
    const properties = isSchema(s.properties) ? s.properties : {};
    // a required property no constraint names (z.unknown()) is null: an undefined one would not survive the page's
    // evaluate, and the key would arrive missing (P5 O4 M2: `connectors.call`'s `request`)
    return Object.fromEntries((Array.isArray(s.required) ? (s.required as string[]) : []).map((key) => [key, sampleOf(properties[key], root) ?? null]));
  }
  if (type === 'array') return Array.from({ length: Number(s.minItems ?? 0) }, () => sampleOf(s.items, root));
  if (type === 'string') return s.format === 'uuid' ? randomUUID() : s.format === 'date-time' ? new Date().toISOString() : 'x'.repeat(Math.max(1, Number(s.minLength ?? 1)));
  if (type === 'integer' || type === 'number') return typeof s.minimum === 'number' ? s.minimum : typeof s.exclusiveMinimum === 'number' ? s.exclusiveMinimum + 1 : 0;
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  return undefined; // no constraint: z.void(), z.unknown()
}

// `value` less every object key `schema` has no property for, through plain nested objects: what that build's own window
// would send, so this checkout's launch defaults reach the other build's app as its renderer would build them.
export function fitTo(schema: unknown, value: unknown, root: unknown = schema): unknown {
  const s = deref(schema, root);
  if (!isSchema(s) || !isSchema(s.properties) || !isSchema(value)) return value;
  const properties = s.properties;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key in properties).map(([key, v]) => [key, fitTo(properties[key], v, root)]));
}

// A command the sampler cannot give an input to, named here with one its schema accepts. P5 O3-D M1: the spine's commands,
// retagged `machine`, joined the manifest and so the probe; those whose sampled input their schema's own refinement
// refuses are named here, each with an input that changes nothing on the scratch profile (an id no session has, a
// journal that does not exist).
export const INPUTS: Record<string, unknown> = {
  // P5 O3-E M2: the checkouts' two whose sample their pattern refuses (a hash's hex, the bytes' base64); an unknown
  // session's, so nothing is written (the upload is refused as a value until M3, and after it for an unknown session)
  'files.upload': { appSessionId: 'x', files: [{ name: 'x', bytes: '' }] },
  'files.write': { appSessionId: 'x', path: 'x', content: '', expectedHash: '0'.repeat(64) },
  'laneA.answer': { appSessionId: 'x', request: 'x', answer: { kind: 'permission', decision: 'deny' } }, // `allow` needs a scope
  'laneA.model': { appSessionId: 'x', model: 'x' }, // a model, an effort or both
  'session.drafts.set': { appSessionId: 'x', draft: null },
  'session.replay.start': { source: { kind: 'journal', path: '/nonexistent/cross-build-probe.jsonl' }, speed: 'instant' }, // an absolute path; no replay starts
  'session.update': { appSessionId: 'x', patch: { pinned: true } }, // a patch sets at least one field
};

// A command whose own handler refuses an input that names no real file: `side.screenshot.preview` reads an image under
// `<userData>/` (an unknown session's only root) and answers `invalid_input` for anything else, so the scratch profile
// holds a one-pixel PNG for it to read.
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export function samplesFor(userData: string): Record<string, unknown> {
  const png = join(userData, 'cross-build-probe.png');
  writeFileSync(png, Buffer.from(PIXEL_PNG, 'base64'));
  return {
    ...INPUTS,
    'side.screenshot.preview': { appSessionId: 'x', screenshot: { path: png, width: 1, height: 1 } },
    // P5 O4 M2: an absolute path the refinement asks for, a file that does not exist; for an unknown session the sign-in
    // is accepted and ends as failed, reading and writing nothing
    'connectors.signIn': { name: 'x', scope: 'user', cwd: null, path: join(userData, 'cross-build-probe.claude.json'), appSessionId: 'x' },
  };
}
