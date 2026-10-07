// E10 (§Design 2): in detached mode the engine host's events cross a Unix socket as JSON lines, and JSON has no
// `undefined`: a key whose value is `undefined` disappears, and a key typed `z.unknown()` is required by its schema
// (`permission.requested.input`, `hook.callback_*`, `tool.use.input`, `dialog.*`…), so such an event would fail X2 on
// the far side and drop its whole batch. Every event the normaliser draws from the recorded fixtures, and every event
// the disk backfill draws from the transcript fixtures, must survive `JSON.parse(JSON.stringify(...))` and validate
// again as a `session.eventBatch`. The engine-host commands' inputs and outputs cross the same socket (E11 W-E): every
// required key of their schemas that JSON can drop is listed below and covered, and the remote surface's renders the
// fixtures recorded (`ui_render` requests and answers) survive the round trip as `session.ui.render`'s input and output,
// a transcript site's answered props still reading as the renderer reads them.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { parseTranscriptProps, TRANSCRIPT_SITES, type TranscriptSite } from '@shared/engine/surface-rows';
import { commands, type CommandName } from '@shared/ipc/schema';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import type { UiRenderResponse } from '@shared/wire/control';
import type { JournalRow } from '@shared/wire/journal';
import type { TranscriptRecord } from '@shared/wire/transcript';
import {
  FIXTURE_PASSES,
  listJournals,
  listSyntheticJournals,
  listTranscripts,
  loadJournal,
  loadSyntheticJournal,
  loadSyntheticTranscript,
  loadTranscript,
  loadTranscriptFixture,
  TEST_FIXTURE_DIR,
  TRANSCRIPT_FIXTURE_DIR,
} from '../../../test/support/fixtures';
import { createBackfillContext, recordToEvents } from '../fs/backfill';
import { Normalizer } from '../normalizer';
import { renderAnswerOf } from '../surface-wire';
import { sessionIdOf } from './harness';

function normalised(journal: JournalRow[]): SessionEvent[] {
  const normalizer = new Normalizer({ appSessionId: 'app-json' as never, launchId: 'JSONWIRE', sessionId: sessionIdOf(journal) });
  return journal.flatMap((row) => normalizer.push(row));
}

// The events whose JSON copy no longer validates, with the issues, so a failure names the kind and the key.
function failuresAfterJson(events: SessionEvent[]): string[] {
  const failures: string[] = [];
  for (const event of events) {
    const copy = JSON.parse(JSON.stringify(event)) as unknown;
    const checked = validateEventPayload('session.eventBatch', { appSessionId: 'app-json', events: [copy] } as never);
    if (!checked.ok) failures.push(`${event.kind} ${event.id}: ${JSON.stringify(checked.issues).slice(0, 300)}`);
  }
  return failures;
}

const journals = [
  ...FIXTURE_PASSES.flatMap((pass) => listJournals(pass).map((name) => ({ label: `${pass}/${name}`, load: () => loadJournal(pass, name) }))),
  ...listSyntheticJournals().map((name) => ({ label: `synthetic/${name}`, load: () => loadSyntheticJournal(name) })),
];

// The protocol probe's sidecars, C4's store copies (test/fixtures/transcripts) and the transcript-shaped synthetic files.
const transcripts: { label: string; load: () => TranscriptRecord[] }[] = [
  ...listTranscripts().map((path) => ({ label: path, load: () => loadTranscript(path) })),
  ...readdirSync(TRANSCRIPT_FIXTURE_DIR)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.slice(0, -'.jsonl'.length))
    .map((name) => ({ label: `transcripts/${name}`, load: () => loadTranscriptFixture(name) })),
  ...readdirSync(TEST_FIXTURE_DIR)
    .filter((file) => /^transcript-.*\.jsonl$/.test(file))
    .map((file) => file.slice(0, -'.jsonl'.length))
    .map((name) => ({ label: name, load: () => loadSyntheticTranscript(name) })),
];

describe('the engine host’s events survive a JSON wire', () => {
  it('finds the fixtures', () => {
    expect(journals.length).toBeGreaterThan(100);
    expect(transcripts.length).toBeGreaterThan(25);
  });

  it('every normalised event of every recorded journal validates after a JSON round trip', () => {
    const kinds = new Set<string>();
    let count = 0;
    const failures: string[] = [];
    for (const { label, load } of journals) {
      const events = normalised(load());
      count += events.length;
      for (const event of events) kinds.add(event.kind);
      failures.push(...failuresAfterJson(events).map((failure) => `${label}: ${failure}`));
    }
    expect(count).toBeGreaterThan(1_000);
    // the kinds whose `z.unknown()` keys a missing frame field would empty are among those checked
    for (const kind of ['tool.use', 'tool.result', 'permission.requested', 'permission.resolved', 'hook.callback_requested', 'hook.callback_resolved', 'usage.sample']) expect(kinds).toContain(kind);
    expect(failures).toEqual([]);
  });

  it('the check catches a required unknown-typed key that JSON drops (a negative control)', () => {
    let probe: SessionEvent | undefined;
    for (const { load } of journals) if ((probe = normalised(load()).find((event) => event.kind === 'tool.use'))) break;
    if (!probe) throw new Error('no fixture yields a tool.use');
    expect(failuresAfterJson([probe])).toEqual([]);
    expect(failuresAfterJson([{ ...probe, input: undefined } as SessionEvent])).toHaveLength(1);
  });

  it('every backfilled event of every transcript fixture validates after a JSON round trip', () => {
    let count = 0;
    const failures: string[] = [];
    for (const { label, load } of transcripts) {
      const records = load();
      const sessionId = (records.find((r) => typeof (r as { sessionId?: unknown }).sessionId === 'string') as { sessionId?: string } | undefined)?.sessionId ?? 'json-wire';
      const ctx = createBackfillContext({ sessionId: sessionId as SessionId, agent: null });
      const events = records.flatMap((record) => recordToEvents(record, ctx));
      count += events.length;
      failures.push(...failuresAfterJson(events).map((failure) => `${label}: ${failure}`));
    }
    expect(count).toBeGreaterThan(400);
    expect(failures).toEqual([]);
  });
});

// ---- E11 W-E: the engine-host commands' inputs and outputs -------------------------------------------------------------

// Every key a command schema requires whose value may be undefined (typed `z.unknown()` or `z.any()`): JSON drops such a
// key, and its schema then refuses the copy. Walks objects, arrays, unions, records and wrappers; a key is named
// `<command>:<in|out><path>`, a union member by its index.
function droppableKeys(schema: z.ZodType, path: string, out: string[], seen = new Set<unknown>()): string[] {
  if (seen.has(schema)) return out;
  seen.add(schema);
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def;
  const inner = (key: string) => droppableKeys(def[key] as z.ZodType, path, out, seen);
  switch (def.type) {
    case 'object':
      for (const [key, child] of Object.entries(def.shape as Record<string, z.ZodType>)) {
        const zod = (child as unknown as { _zod: { def: { type: string }; optin?: string } })._zod;
        if ((zod.def.type === 'unknown' || zod.def.type === 'any') && zod.optin !== 'optional') out.push(`${path}.${key}`);
        droppableKeys(child, `${path}.${key}`, out, seen);
      }
      break;
    case 'array':
      droppableKeys(def.element as z.ZodType, `${path}[]`, out, seen);
      break;
    case 'union':
      (def.options as z.ZodType[]).forEach((option, k) => droppableKeys(option, `${path}|${k}`, out, seen));
      break;
    case 'record':
      droppableKeys(def.valueType as z.ZodType, `${path}{}`, out, seen);
      break;
    case 'optional': case 'nullable': case 'default': case 'readonly': case 'catch': case 'nonoptional':
      inner('innerType');
      break;
    case 'pipe':
      inner('in');
      inner('out');
      break;
    case 'intersection':
      inner('left');
      inner('right');
      break;
    case 'lazy':
      droppableKeys((def.getter as () => z.ZodType)(), path, out, seen);
      break;
  }
  return out;
}

// The recorded `ui_render` asks and their answers, in every fixture of every pass.
function recordedRenders(): { label: string; request: Record<string, unknown>; answer: UiRenderResponse }[] {
  const out: { label: string; request: Record<string, unknown>; answer: UiRenderResponse }[] = [];
  for (const { label, load } of journals) {
    const asked = new Map<string, Record<string, unknown>>();
    for (const row of load()) {
      const frame = row.frame as { type?: string; request_id?: string; request?: { subtype?: string } & Record<string, unknown>; response?: { request_id?: string; subtype?: string; response?: UiRenderResponse } };
      if (row.direction === 'out' && frame.type === 'control_request' && frame.request?.subtype === 'ui_render') asked.set(frame.request_id!, frame.request);
      const request = frame.type === 'control_response' && row.direction === 'in' ? asked.get(frame.response?.request_id ?? '') : undefined;
      if (request && frame.response?.subtype === 'success' && frame.response.response) out.push({ label, request, answer: frame.response.response });
    }
  }
  return out;
}

// `session.ui.render`'s input for a recorded ask, as main would send it (the host adds the surface and client id).
const renderInput = (request: Record<string, unknown>) => ({
  appSessionId: 'app-json', component: request.component, instanceId: request.instance_id, props: request.props,
  ...(request.viewport !== undefined && { viewport: request.viewport }), ...(request.content_rows !== undefined && { contentRows: request.content_rows }), ...(request.keyed !== undefined && { keyed: request.keyed }),
});
const isTranscriptSite = (component: unknown): component is TranscriptSite => (TRANSCRIPT_SITES as readonly unknown[]).includes(component);

// What a JSON copy of one recorded render loses: the command's input or output no longer validating, or a transcript
// site's answered props no longer reading as the renderer reads them (parseTranscriptProps against the asked props).
function renderFailuresAfterJson(request: Record<string, unknown>, answer: UiRenderResponse): string[] {
  const failures: string[] = [];
  const input = renderInput(request);
  const output = renderAnswerOf(answer, request.props as Record<string, unknown>);
  const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const inputCopy = validateCommandInput('session.ui.render', json(input) as never);
  if (!inputCopy.ok) failures.push(`input: ${JSON.stringify(inputCopy.issues).slice(0, 300)}`);
  const outputCopy = validateCommandOutput('session.ui.render', json(output));
  if (!outputCopy.ok) failures.push(`output: ${JSON.stringify(outputCopy.issues).slice(0, 300)}`);
  const component = request.component;
  if (isTranscriptSite(component) && parseTranscriptProps(component, output.props, request.props as never) !== null && parseTranscriptProps(component, json(output).props, request.props as never) === null) {
    failures.push(`output props: ${component} reads as the renderer reads it, and not after JSON`);
  }
  return failures;
}

describe('the engine-host commands survive a JSON wire (E11 W-E)', () => {
  // Reviewed: each is covered. The event arrays are the events above (the same normaliser and backfill draw them); a
  // render answer's `tree` is the engine's node or ENGINE_NODE (renderAnswerOf), never undefined. A new entry here is a
  // key a JSON copy can lose: cover it with a fixture round trip below, or make it optional or null-valued.
  const EVENT_KEYS = ['permissionDenials[].toolInput', 'input', 'structured', 'response', 'updatedInput', 'payload', 'result', 'content', 'progress'];
  it('lists every required key of an engine-host command that JSON can drop, and nothing else', () => {
    const found = Object.entries(commands)
      .filter(([, spec]) => (spec as { owner: string }).owner === 'engine-host')
      .flatMap(([name, spec]) => [...droppableKeys((spec as { input: z.ZodType }).input, `${name}:in`, []), ...droppableKeys((spec as { output: z.ZodType }).output, `${name}:out`, [])]);
    const eventKey = (key: string) => /^(session\.events:out\.events\[\]|session\.pendingRequest:out\.event|fs\.agentEvents:out\.events\[\])\|\d+\.(.+)$/.exec(key)?.[2];
    expect(found.filter((key) => !EVENT_KEYS.includes(eventKey(key) ?? ''))).toEqual(['session.ui.render:out.tree']);
    expect(new Set(found.map(eventKey).filter(Boolean))).toEqual(new Set(EVENT_KEYS));
  });

  it("every recorded ui_render ask and answer validates as session.ui.render's input and output after a JSON round trip", () => {
    const renders = recordedRenders();
    expect(renders.length).toBeGreaterThan(20);
    const sites = new Set(renders.map((r) => r.request.component));
    for (const site of TRANSCRIPT_SITES) expect(sites, `a recorded render of the ${site} site`).toContain(site);
    const valid = renders.filter(({ request }) => validateCommandInput('session.ui.render', renderInput(request) as never).ok);
    expect(valid.length).toBe(renders.length);
    expect(valid.flatMap(({ label, request, answer }) => renderFailuresAfterJson(request, answer).map((failure) => `${label} ${String(request.component)} ${String(request.instance_id)}: ${failure}`))).toEqual([]);
  });

  it('the check catches what a JSON copy of a render loses (negative controls)', () => {
    const call = { tool_use_id: 'tool-1', tool: 'Read', input: { file_path: '/a' }, isRunning: false, isErrored: false, isInterrupted: false };
    const ask = { subtype: 'ui_render', component: 'ToolUse', instance_id: 'tool-1', props: call };
    expect(renderFailuresAfterJson(ask, { props: call })).toEqual([]);
    // an answered call whose input is undefined: the structured clone keeps the key, JSON drops it, the renderer refuses
    expect(renderFailuresAfterJson(ask, { props: { ...call, input: undefined } })).toEqual(['output props: ToolUse reads as the renderer reads it, and not after JSON']);
    // a render answer whose tree is undefined: the output's required unknown key is dropped
    expect(validateCommandOutput('session.ui.render' as CommandName, JSON.parse(JSON.stringify({ tree: undefined, props: {}, rewritten: false, hooked: false }))).ok).toBe(false);
  });
});
