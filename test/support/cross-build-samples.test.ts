// The cross-build group's command samples (e2e/support/cross-build-samples.ts): the gap probe in e2e/cross-build.spec.ts
// sends each command a newer build's window can send its sample, and fails on any the registry refuses as input, one
// name per CI round trip. Here every command of this build's wire manifest, less the main-only ones no window can send,
// has its sample held to the same validation main's router applies, so a refused sample is named before the e2e runs.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ipcError } from '@shared/ipc/errors';
import { MAIN_ONLY_COMMANDS } from '@shared/ipc/names';
import type { WireManifest } from '@shared/ipc/wire';
import { validateCommandInput } from '@shared/ipc/validate';
import { answerOf, refusedSample, sampleOf, samplesFor } from '../../e2e/support/cross-build-samples';

const manifest = JSON.parse(readFileSync(join(__dirname, '../../src/shared/ipc/wire-manifest.json'), 'utf8')) as WireManifest;
const mainOnly = new Set<string>(MAIN_ONLY_COMMANDS);
const sent = Object.entries(manifest.entries)
  .filter(([key]) => key.startsWith('commands.') && !mainOnly.has(key.slice('commands.'.length)))
  .map(([key, entry]) => [key.slice('commands.'.length), (entry as { input: unknown }).input] as const);

// Refused samples of commands no probed gap has carried yet: each would need an input that changes nothing (most run the
// plugins CLI under an absolute cwd and binary), named in INPUTS when a gap first brings it. The list is exact, so a
// sample newly refused, or one now given, fails here.
const NOT_YET_NAMED = [
  'artifacts.uploadAsset', 'artifacts.versionState', 'connectors.add', 'connectors.remove', 'customization.inventory',
  'marketplaces.add', 'marketplaces.list', 'marketplaces.remove', 'marketplaces.update', 'plugins.available', 'plugins.disable',
  'plugins.enable', 'plugins.install', 'plugins.list', 'plugins.manifest', 'plugins.marketplaceManifest', 'plugins.uninstall',
  'plugins.update', 'session.answer', 'session.replay.launch',
];

// What a page's evaluate delivers: an object key whose value is undefined arrives missing.
const delivered = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(delivered)
    : typeof value === 'object' && value !== null && !(value instanceof Uint8Array) ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, delivered(v)]))
      : value;

const userData = mkdtempSync(join(tmpdir(), 'maws-cross-build-samples-'));
afterAll(() => rmSync(userData, { recursive: true, force: true }));

describe('the cross-build probe’s samples', () => {
  it('cover the commands a window can send', () => {
    expect(sent.length).toBeGreaterThan(100);
  });

  it('are each accepted as input by the registry as the page delivers them, but for the commands not yet named', () => {
    const named = samplesFor(userData);
    const refused = sent.flatMap(([name, schema]) => {
      const input = name in named ? named[name] : sampleOf(schema);
      const checked = validateCommandInput(name as never, input === undefined ? undefined : delivered(input));
      return checked.ok ? [] : [{ name, why: checked.error.message }];
    });
    expect(refused.filter(({ name }) => !NOT_YET_NAMED.includes(name))).toEqual([]);
    expect(refused.map(({ name }) => name).sort()).toEqual([...NOT_YET_NAMED].sort());
  });
});

// P5 O4 M3 (the gate's cross-build run 41232909369): a command retagged `machine` joins the manifest and so the probe; one
// that looks its sampled id up answers it unknown, `invalid_input` by the engine host's store convention. That answer
// reached the command's handler and changed nothing: the probe counts it as no refused sample, unlike the registry's.
describe('the probe’s reading of an answer', () => {
  const sample = sampleOf((manifest.entries['commands.library.content'] as { input: unknown }).input) as { artifactId: string };

  it('counts an unknown sampled id’s refusal as reached, with the id masked so either supervisor’s answer compares', () => {
    const unknown = ipcError('invalid_input', `no artifact ${sample.artifactId}`, { reason: 'notFound', data: { artifactId: sample.artifactId } });
    const answer = answerOf({ ok: false, error: unknown }, sample);
    expect(answer).toEqual({ ok: false, code: 'invalid_input', message: 'no artifact <sampled id>' });
    expect(refusedSample(answer)).toBe(false);
    expect(refusedSample(answerOf({ ok: true }, sample))).toBe(false);
    expect(refusedSample(answerOf({ ok: false, error: ipcError('internal', `no artifact ${sample.artifactId}`) }, sample))).toBe(false);
  });

  it('counts the registry’s refusal, and a handler’s that names no sampled id, as a refused sample', () => {
    const registry = validateCommandInput('library.content', { artifactId: 'x' });
    expect(registry.ok).toBe(false);
    expect(refusedSample(answerOf(registry as { ok: false; error: { code: string; message: string } }, { artifactId: 'x' }))).toBe(true);
    expect(refusedSample(answerOf({ ok: false, error: ipcError('invalid_input', 'the screenshot is not under userData') }, sample))).toBe(true);
  });

  // (the re-review) only the unknown id's own answer is exempt: a handler that found the id and refused it otherwise
  // never ran the command's work
  it('counts a refusal that names the sampled id but is not the unknown id’s answer as a refused sample', () => {
    const otherKind = answerOf({ ok: false, error: ipcError('invalid_input', `artifact ${sample.artifactId} is not a file artifact`) }, sample);
    expect(otherKind).toEqual({ ok: false, code: 'invalid_input', message: 'artifact <sampled id> is not a file artifact' });
    expect(refusedSample(otherKind)).toBe(true);
    expect(refusedSample(answerOf({ ok: false, error: ipcError('invalid_input', `no artifact ${sample.artifactId} at revision 3`) }, sample))).toBe(true);
  });
});
