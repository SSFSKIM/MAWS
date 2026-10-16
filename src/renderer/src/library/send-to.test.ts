// P3-H "Send to" (Decision Log 87, 88): the run behind the library's Send to sheet. The export snapshot first, then the
// artifact's session (live as it is, else started or resumed with no message, its card or refusal ending the attempt),
// then the owner's request through the human prompt path, and the session opened; a cancel stops everything after it,
// and a retry reuses the session an earlier attempt created.
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactSessionContext, ArtifactSessionEnd, ArtifactSessionStart } from '../artifacts/session-context';
import type { HumanPromptOptions, HumanPromptResult } from '../composer/submit/send-human-prompt';
import { deferred } from '../test-support/code';
import { createSendToRun, defaultSendFormat, sendToPrompt, type SendRequest, type SendToDeps, type SendToPhase } from './send-to';

const OWN = 'own-session' as AppSessionId;
const NEW = 'new-session' as AppSessionId;
const EXPORTED = { path: '/ud/artifacts/a1/exports/7-docx.docx', revision: 7 };
const SESSION: ArtifactSessionContext = { kind: 'session', appSessionId: OWN };
const DIRECTORY: ArtifactSessionContext = { kind: 'directory', path: '/work/app', projectId: null };
const request = (over: Partial<SendRequest> = {}): SendRequest => ({ artifactId: 'a1', title: 'Launch plan', kind: 'document', target: 'drive', format: 'docx', context: SESSION, ...over });

function harness(over: Partial<SendToDeps> & { live?: AppSessionId[]; exported?: Promise<unknown> | unknown } = {}) {
  const live = new Set(over.live ?? []);
  const invoke = vi.fn(async (name: string) => {
    if (name !== 'artifacts.export') throw new Error(`unexpected ${name}`);
    return 'exported' in over ? await over.exported : { ok: true, value: EXPORTED };
  });
  const deps: SendToDeps = {
    client: { invoke, on: vi.fn() } as unknown as MawsBridge,
    start: over.start ?? vi.fn(async (): Promise<ArtifactSessionStart> => ({ status: 'ready', appSessionId: NEW })),
    send: over.send ?? vi.fn(async (): Promise<HumanPromptResult> => ({ disposition: 'sent', started: false })),
    isLive: (id) => live.has(id),
    open: vi.fn(),
  };
  const run = createSendToRun(deps);
  const phases: SendToPhase['phase'][] = [];
  run.state.subscribe((s) => phases.push(s.phase));
  return { run, deps, invoke, phases, live };
}

// A start that answers `starting` and ends when the test settles it.
function startingStart(appSessionId: AppSessionId) {
  const end = deferred<ArtifactSessionEnd>();
  const cancel = vi.fn();
  const start = vi.fn(async (): Promise<ArtifactSessionStart> => ({ status: 'starting', appSessionId, settled: end.promise, cancel }));
  return { start, end, cancel };
}

describe('the format a target starts with', () => {
  it('is DOCX for Drive and Markdown for Notion for a document, else the best the kind’s exporters serve', () => {
    const documentFormats = ['md', 'html', 'docx', 'pdf'] as const;
    expect(defaultSendFormat('drive', documentFormats)).toBe('docx');
    expect(defaultSendFormat('notion', documentFormats)).toBe('md');
    expect(defaultSendFormat('drive', ['pptx', 'pdf'])).toBe('pptx');
    expect(defaultSendFormat('notion', ['pptx', 'pdf'])).toBe('pdf');
    expect(defaultSendFormat('drive', ['pdf', 'png'])).toBe('pdf');
    expect(defaultSendFormat('notion', ['claude'])).toBe('claude');
    expect(defaultSendFormat('drive', [])).toBeNull();
  });
});

describe('the request the session reads', () => {
  it('names the exported file, what it is, its revision and format, and the service, and asks for no other route', () => {
    const prompt = sendToPrompt(request(), EXPORTED);
    expect(prompt).toContain('Send this file to Google Drive');
    expect(prompt).toContain('`/ud/artifacts/a1/exports/7-docx.docx`');
    expect(prompt).toContain('“Launch plan” (Document, revision 7) exported as Word document');
    expect(prompt).toContain('If no Google Drive connector here can take a file, say so rather than reaching Google Drive another way');
    expect(sendToPrompt(request({ target: 'notion', format: 'md' }), EXPORTED)).toContain('Send this file to Notion');
  });
});

describe('a Send to run', () => {
  it('exports the chosen format, sends the request in the artifact’s live session with no start, and opens it', async () => {
    const { run, deps, invoke, phases } = harness({ live: [OWN] });
    await run.send(request());
    expect(invoke).toHaveBeenCalledWith('artifacts.export', { artifactId: 'a1', format: 'docx' });
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.send).toHaveBeenCalledWith(OWN, sendToPrompt(request(), EXPORTED), expect.objectContaining({ origin: 'sendTo' }));
    expect(deps.open).toHaveBeenCalledWith(OWN);
    expect(phases).toEqual(['exporting', 'sending', 'sent']);
  });

  it('starts a session in the artifact’s directory first, waits for its setup to end ready, then sends there', async () => {
    const { start, end } = startingStart(NEW);
    const { run, deps, phases } = harness({ start });
    const sending = run.send(request({ context: DIRECTORY }));
    await vi.waitFor(() => expect(run.state.getState()).toEqual({ phase: 'starting', appSessionId: NEW }));
    expect(start).toHaveBeenCalledWith(DIRECTORY, null);
    expect(deps.send).not.toHaveBeenCalled();
    end.resolve({ status: 'ready', appSessionId: NEW });
    await sending;
    expect(deps.send).toHaveBeenCalledWith(NEW, expect.any(String), expect.objectContaining({ origin: 'sendTo' }));
    expect(deps.open).toHaveBeenCalledWith(NEW);
    expect(phases.at(-1)).toBe('sent');
    expect(run.previous()).toBe(NEW);
  });

  it('resumes the artifact’s own session when it is not live', async () => {
    const { run, deps } = harness({ start: vi.fn(async (): Promise<ArtifactSessionStart> => ({ status: 'ready', appSessionId: OWN })) });
    await run.send(request());
    expect(deps.start).toHaveBeenCalledWith(SESSION, null);
    expect(deps.send).toHaveBeenCalledWith(OWN, expect.any(String), expect.anything());
  });

  it('ends at a trust card with its words and the session to open, sends nothing, and a retry reuses that session', async () => {
    const start = vi.fn<SendToDeps['start']>().mockResolvedValueOnce({ status: 'card', appSessionId: NEW, words: 'Trust this folder in the session to continue' }).mockResolvedValueOnce({ status: 'ready', appSessionId: NEW });
    const { run, deps } = harness({ start });
    await run.send(request({ context: DIRECTORY }));
    expect(run.state.getState()).toEqual({ phase: 'failed', words: 'Trust this folder in the session to continue', appSessionId: NEW });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
    await run.send(request({ context: DIRECTORY }));
    expect(start).toHaveBeenLastCalledWith(DIRECTORY, NEW);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(run.state.getState()).toEqual({ phase: 'sent', appSessionId: NEW });
  });

  it('uses the session an earlier attempt started once it is live, with no second start', async () => {
    const start = vi.fn<SendToDeps['start']>().mockResolvedValueOnce({ status: 'ready', appSessionId: NEW });
    const send = vi.fn<SendToDeps['send']>().mockResolvedValueOnce({ disposition: 'refused', started: false, reason: 'Session ended' }).mockResolvedValueOnce({ disposition: 'sent', started: false });
    const { run, live } = harness({ start, send });
    await run.send(request({ context: DIRECTORY }));
    expect(run.state.getState()).toEqual({ phase: 'failed', words: 'Session ended', appSessionId: NEW });
    live.add(NEW);
    await run.send(request({ context: DIRECTORY }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(NEW, expect.any(String), expect.anything());
  });

  it('a start refused for a prompt waiting in the session (Decision Log 88) ends the attempt with its words; nothing is sent', async () => {
    const words = 'A message is waiting in this session; send or clear it first';
    const { run, deps } = harness({ start: vi.fn(async (): Promise<ArtifactSessionStart> => ({ status: 'refused', appSessionId: OWN, words })) });
    await run.send(request());
    expect(run.state.getState()).toEqual({ phase: 'failed', words, appSessionId: OWN });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('an export that fails ends the attempt before any session is touched', async () => {
    const { run, deps } = harness({ exported: { ok: false, error: { code: 'invalid_input', message: 'no exporter' } } });
    await run.send(request());
    expect(run.state.getState()).toEqual({ phase: 'failed', words: 'Couldn’t export: no exporter', appSessionId: null });
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('a send the session refuses, or that throws, ends the attempt with its words and the session to open', async () => {
    const refused = harness({ live: [OWN], send: vi.fn(async (): Promise<HumanPromptResult> => ({ disposition: 'refused', started: false })) });
    await refused.run.send(request());
    expect(refused.run.state.getState()).toEqual({ phase: 'failed', words: 'The session didn’t take the request', appSessionId: OWN });
    const thrown = harness({ live: [OWN], send: vi.fn(async () => Promise.reject(new Error('host unreachable'))) });
    await thrown.run.send(request());
    expect(thrown.run.state.getState()).toEqual({ phase: 'failed', words: 'host unreachable', appSessionId: OWN });
    expect(thrown.deps.open).not.toHaveBeenCalled();
  });

  it('a cancel during the export stops the run there: no start, no send', async () => {
    const answer = deferred<unknown>();
    const { run, deps } = harness({ exported: answer.promise });
    const sending = run.send(request({ context: DIRECTORY }));
    run.cancel();
    answer.resolve({ ok: true, value: EXPORTED });
    await sending;
    expect(run.state.getState()).toEqual({ phase: 'cancelled' });
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('a cancel while the session starts stops listening for it and sends nothing when it ends ready', async () => {
    const { start, end, cancel } = startingStart(NEW);
    const { run, deps } = harness({ start });
    const sending = run.send(request({ context: DIRECTORY }));
    await vi.waitFor(() => expect(run.state.getState().phase).toBe('starting'));
    run.cancel();
    expect(cancel).toHaveBeenCalled();
    end.resolve({ status: 'ready', appSessionId: NEW });
    await sending;
    expect(run.state.getState()).toEqual({ phase: 'cancelled' });
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
  });

  it('a cancel after the send was handed over withdraws it before dispatch through `current`', async () => {
    let options: HumanPromptOptions | null = null;
    const gate = deferred<HumanPromptResult>();
    const send = vi.fn(async (_id: AppSessionId, _prompt: string, given: HumanPromptOptions) => {
      options = given;
      return gate.promise;
    });
    const { run, deps } = harness({ live: [OWN], send });
    const sending = run.send(request());
    await vi.waitFor(() => expect(options).not.toBeNull());
    expect(options!.current!()).toBe(true);
    run.cancel();
    expect(options!.current!()).toBe(false);
    gate.resolve({ disposition: 'refused', started: false });
    await sending;
    expect(run.state.getState()).toEqual({ phase: 'cancelled' });
    expect(deps.open).not.toHaveBeenCalled();
  });
});
