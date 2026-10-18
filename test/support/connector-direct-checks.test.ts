// P3-HD M4b: the pure checks route D's integrated scenes (e2e/connectors-direct.spec.ts, e2e/connectors-oauth.spec.ts) rest their custody, listener,
// sealed-record, journal, bearer and page claims on (e2e/support/connector-direct-checks.ts). No app, engine, socket or
// fixture process: each check is driven with the values a scene would read.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addedListeners, attachIfClean, bearerCrossings, blankResumeStartupRejection, boundedAcquire, boundedMetaRows, forbiddenFrames, isBlankResume, journalFilesOf, journalFrameShapes, readJournalRows, custodyProblems, heldFate, isRetainedScratch, journalTurns, loopbackPort, nodeScratchFs, oncePageHtml, pageVariant, plaintextHits, readSealedText,
  scanScratchTree, scrubDiagnostic, SEALED_FORMAT, shellQuoted, type ScratchFs,
} from '../../e2e/support/connector-direct-checks';

describe('custodyProblems: the scratch profile and mock keychain a launch must show before any owner action', () => {
  const good = { mockKeychain: true, userData: '/private/var/folders/x/T/maws-connectors-a/ud', scratch: '/private/var/folders/x/T/maws-connectors-a/ud', expected: '/private/var/folders/x/T/maws-connectors-a/ud', tmp: '/private/var/folders/x/T' };

  it('answers none for the scene’s own canonical profile under the temporary directory, the switch present', () => {
    expect(custodyProblems(good)).toEqual([]);
  });

  it('names each missing fact by a closed word', () => {
    expect(custodyProblems({ ...good, mockKeychain: false })).toEqual(['mockKeychain']);
    expect(custodyProblems({ ...good, userData: null })).toEqual(['userData', 'profile', 'notTemporary']);
    expect(custodyProblems({ ...good, scratch: null })).toEqual(['scratch']);
    expect(custodyProblems({ ...good, expected: null })).toEqual(['profile', 'scratch']);
    expect(custodyProblems({ ...good, tmp: null })).toEqual(['notTemporary']);
  });

  it('refuses another profile, a profile the harness did not name and one outside the temporary directory', () => {
    expect(custodyProblems({ ...good, userData: '/Users/owner/Library/Application Support/MAWS' })).toEqual(['profile', 'notTemporary']);
    expect(custodyProblems({ ...good, scratch: '/private/var/folders/x/T/other/ud' })).toEqual(['scratch']);
    const outside = '/opt/maws-connectors-a/ud';
    expect(custodyProblems({ ...good, userData: outside, scratch: outside, expected: outside })).toEqual(['notTemporary']);
  });

  it('takes the temporary directory itself, or a sibling sharing its prefix, as not under it', () => {
    const tmp = good.tmp;
    expect(custodyProblems({ ...good, userData: tmp, scratch: tmp, expected: tmp })).toEqual(['notTemporary']);
    const sibling = `${tmp}-other/ud`;
    expect(custodyProblems({ ...good, userData: sibling, scratch: sibling, expected: sibling })).toEqual(['notTemporary']);
  });
});

describe('the loopback listener a Connect binds', () => {
  it('lists the listeners added since a baseline, each once', () => {
    expect(addedListeners(['127.0.0.1:9229'], ['127.0.0.1:9229', '127.0.0.1:53111', '127.0.0.1:53111'])).toEqual(['127.0.0.1:53111']);
    expect(addedListeners([], [])).toEqual([]);
    expect(addedListeners(['127.0.0.1:1'], [])).toEqual([]);
  });

  it('takes a port only from an exact 127.0.0.1 address', () => {
    expect(loopbackPort('127.0.0.1:53111')).toBe(53111);
    for (const address of ['*:53111', '[::1]:53111', 'localhost:53111', '0.0.0.0:53111', '127.0.0.1:', '127.0.0.1:0', '127.0.0.1:70000', '127.0.0.10:53111', '127.0.0.1:53111x', ' 127.0.0.1:53111']) {
      expect(loopbackPort(address), address).toBeNull();
    }
  });
});

describe('readSealedText: a sealed OAuth record’s plain format line and base64 ciphertext', () => {
  const ciphertext = Buffer.from([0x76, 0x31, 0x30, 0x00, 0xff, 0x10, 0x20]);

  it('reads the format line and the ciphertext bytes', () => {
    const read = readSealedText(`${SEALED_FORMAT}\n${ciphertext.toString('base64')}\n`);
    expect(read).toEqual({ ok: true, ciphertext });
  });

  it('refuses another format line, a missing body, trailing content and a body that is not canonical base64', () => {
    expect(readSealedText(`maws-connector-oauth/2\n${ciphertext.toString('base64')}\n`)).toEqual({ ok: false, why: 'format' });
    expect(readSealedText(`${SEALED_FORMAT}\n`)).toEqual({ ok: false, why: 'body' });
    expect(readSealedText(`${SEALED_FORMAT}\n${ciphertext.toString('base64')}\nmore\n`)).toEqual({ ok: false, why: 'body' });
    expect(readSealedText(`${SEALED_FORMAT}\n{"tokens":{}}\n`)).toEqual({ ok: false, why: 'body' });
    expect(readSealedText(`${SEALED_FORMAT}\n${ciphertext.toString('base64')}`)).toEqual({ ok: false, why: 'body' });
  });
});

describe('plaintextHits: which known values appear in bytes', () => {
  it('answers the indexes of the needles found, as UTF-8 or Latin-1, never the values', () => {
    const bytes = Buffer.concat([Buffer.from('\x00\x01'), Buffer.from('http://127.0.0.1:4100/mcp', 'utf8'), Buffer.from([0xe9]), Buffer.from('tail')]);
    expect(plaintextHits(bytes, ['absent', 'http://127.0.0.1:4100/mcp', 'tail', ''])).toEqual([1, 2]);
    expect(plaintextHits(Buffer.from('café', 'latin1'), ['café'])).toEqual([0]);
    expect(plaintextHits(Buffer.alloc(0), ['x'])).toEqual([]);
  });
});

describe('journalTurns: launches and model traffic in a session’s journal rows', () => {
  const row = (direction: string, frame: unknown) => ({ direction, frame });

  it('counts spawns and exits, user frames sent and model frames received', () => {
    const rows = [
      row('meta', { event: 'spawn' }),
      row('out', { type: 'control_request', request: { subtype: 'mcp_status' } }),
      row('in', { type: 'control_response', response: { subtype: 'success', response: { mcpServers: [{ name: 'fixture', status: 'connected' }] } } }),
      row('in', { type: 'system', subtype: 'init' }),
      row('meta', { event: 'exit' }),
      row('meta', { event: 'spawn' }),
    ];
    expect(journalTurns(rows)).toEqual({ spawns: 2, exits: 1, userFrames: 0, modelFrames: 0, needsAuth: 0 });
  });

  it('counts a user message, an assistant, a result and a stream event as a turn, and a needs-auth report', () => {
    const rows = [
      row('out', { type: 'user', message: { role: 'user', content: 'hi' } }),
      row('in', { type: 'assistant', message: {} }),
      row('in', { type: 'stream_event', event: {} }),
      row('in', { type: 'result', subtype: 'success' }),
      row('in', { type: 'control_response', response: { response: { mcpServers: [{ name: 'fixture', status: 'needs-auth' }] } } }),
      row('stderr', { text: 'needs-auth' }), // not a report
      row('in', { type: 'user' }), // a tool result echoed in is not one sent
    ];
    expect(journalTurns(rows)).toEqual({ spawns: 0, exits: 0, userFrames: 1, modelFrames: 3, needsAuth: 1 });
  });
});

describe('scrubDiagnostic / boundedAcquire / boundedMetaRows: a failed launch’s evidence, bounded and scrubbed', () => {
  const roots = ['/private/var/folders/x/T/maws-connectors-a'];
  const secret = 'AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789';

  it('replaces the scene’s paths, the home directory and any other user’s home, and token-like runs; truncates', () => {
    const text = `ENOENT /private/var/folders/x/T/maws-connectors-a/ud/x and ${homedir()}/y and /Users/someone/z token=${secret}`;
    const scrubbed = scrubDiagnostic(text, roots, 400);
    expect(scrubbed).toContain('<scratch>/ud/x');
    expect(scrubbed).toContain('<home>/y');
    expect(scrubbed).toContain('/Users/<user>/z');
    expect(scrubbed).toContain('token=<redacted>');
    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).not.toContain('maws-connectors-a');
    expect(scrubDiagnostic('x'.repeat(50) + ' y'.repeat(300), roots, 100).length).toBeLessThanOrEqual(101);
  });

  it('keeps a failed acquire’s status, message and resource states, scrubbed, and names (never copies) any other key', () => {
    const bounded = boundedAcquire(
      { status: 'failed', appSessionId: 'a1', message: `No conversation found with session ID: x (${roots[0]}/ud)`, resources: { worktree: null, record: 'kept', transcript: 'none' }, extra: { secret }, token: secret },
      roots,
    );
    expect(bounded).toEqual({
      status: 'failed',
      appSessionId: 'a1',
      message: 'No conversation found with session ID: x (<scratch>/ud)',
      resources: { worktree: null, record: 'kept', transcript: 'none' },
      otherKeys: ['extra', 'token'],
    });
    expect(JSON.stringify(bounded)).not.toContain(secret);
  });

  it('keeps a ready acquire’s flags and answers a non-object as its type', () => {
    expect(boundedAcquire({ status: 'ready', appSessionId: 'a1', launched: true, joined: false }, roots)).toEqual({ status: 'ready', appSessionId: 'a1', launched: true, joined: false });
    expect(boundedAcquire(undefined, roots)).toEqual({ notAnObject: 'undefined' });
  });

  it('keeps only the allowlisted scalar fields of meta rows, in order; spawn args are a count, never copied', () => {
    const rows = [
      { direction: 'meta', frame: { event: 'spawn', args: ['--resume', 'id', `--mcp-config=${secret}`], pid: 7 } },
      { direction: 'out', frame: { type: 'control_request' } },
      { direction: 'meta', frame: { event: 'init_failed', message: `No conversation found (${roots[0]}/ud)`, code: 'x', env: { SECRET: secret } } },
      { direction: 'stderr', frame: { text: 'ignored' } },
      { direction: 'meta', frame: { event: 'exit', code: 1, signal: null, reason: 'crash' } },
    ];
    expect(boundedMetaRows(rows, roots)).toEqual({
      rows: [
        { event: 'spawn', argCount: 3, pid: 7 },
        { event: 'init_failed', message: 'No conversation found (<scratch>/ud)', code: 'x' },
        { event: 'exit', code: 1, signal: null, reason: 'crash' },
      ],
      omitted: 0,
    });
  });

  it('bounds the number of rows and counts the omitted', () => {
    const rows = Array.from({ length: 100 }, () => ({ direction: 'meta', frame: { event: 'reconnect', phase: 'attempting' } }));
    const bounded = boundedMetaRows(rows, roots);
    expect(bounded.rows).toHaveLength(64);
    expect(bounded.omitted).toBe(36);
  });
});

describe('isBlankResume: the one failed acquire the scene accepts as the documented transcript-less resume (P3-HD Decision Log 40)', () => {
  const refused = 'No conversation found with session ID: 0a1b';
  const failed = { status: 'failed', appSessionId: 'a1', message: `engine exited: ${refused}`, resources: { worktree: null, record: 'kept', transcript: 'none' } };
  const journal = [{ event: 'spawn', argCount: 4 }, { event: 'init_failed', message: refused }, { event: 'exit', code: 1 }];

  it('is positive only when the answer, its resources and the launch’s own init_failed row all say so', () => {
    expect(isBlankResume(failed, journal)).toBe(true);
  });

  it('is negative for a ready answer, another failure, a transcript that exists, or a journal that does not agree', () => {
    expect(isBlankResume({ status: 'ready', appSessionId: 'a1', launched: true, joined: false }, journal)).toBe(false);
    expect(isBlankResume({ ...failed, message: 'engine exited: EACCES' }, [{ event: 'init_failed', message: 'EACCES' }])).toBe(false);
    expect(isBlankResume({ ...failed, resources: { ...failed.resources, transcript: 'kept' } }, journal)).toBe(false);
    expect(isBlankResume(failed, [{ event: 'spawn' }, { event: 'exit' }])).toBe(false);
    expect(isBlankResume(failed, [{ event: 'init_failed', message: 'timed out' }])).toBe(false);
    expect(isBlankResume(failed, [{ event: 'spawn', message: refused }])).toBe(false);
  });

  it('is negative for anything that is not an answer', () => {
    for (const value of [undefined, null, 'failed', 7, [], { status: 'failed' }, { status: 'failed', message: refused }]) expect(isBlankResume(value, journal)).toBe(false);
  });
});

describe('blankResumeStartupRejection / journalFrameShapes: the one inbound error result the transition scene accepts on the old session (P3-HD Decision Log 42)', () => {
  // The failed wire shape is not yet observed: these fixtures are proposed classifier cases, not the engine's real frame.
  const row = (direction: string, frame: unknown) => ({ direction, frame });
  const spawn = row('meta', { event: 'spawn', args: ['--resume', 'x'] });
  const initFailed = row('meta', { event: 'init_failed', message: 'No conversation found with session ID: x' });
  const exit = row('meta', { event: 'exit', code: 1 });
  // the shape run 39077555852 observed for the refused resume's result (zero everywhere; descriptive strings, an empty iterations list)
  const usage = {
    output_tokens_details: { thinking_tokens: 0 },
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: 'standard',
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    inference_geo: 'not_available',
    iterations: [] as unknown[],
    speed: 'standard',
    fallback_credit: null,
  };
  const result = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['No conversation found with session ID: x'], num_turns: 0, total_cost_usd: 0, usage, modelUsage: {} };
  const good = () => [spawn, row('in', { type: 'system', subtype: 'init' }), exit, spawn, row('in', result), initFailed, exit];
  const withResult = (patch: Record<string, unknown>) => [spawn, exit, spawn, row('in', { ...result, ...patch }), initFailed, exit];
  const failures = (rows: ReturnType<typeof good>) => blankResumeStartupRejection(rows).failures;

  it('accepts exactly one explicit zero-turn, zero-cost, zero-usage error result in the second spawn, with the init_failed row', () => {
    expect(blankResumeStartupRejection(good())).toMatchObject({ ok: true, failures: [] });
  });

  it('rejects an absent, a repeated, a misplaced or an outbound result', () => {
    expect(failures([spawn, exit, spawn, initFailed, exit])).toContain('results');
    expect(failures([...good(), row('in', result)])).toContain('results');
    expect(failures([spawn, row('in', result), exit, spawn, initFailed, exit])).toContain('spawn');
    expect(failures([spawn, exit, spawn, exit, spawn, row('in', result), initFailed])).toContain('spawn');
    expect(failures([result].map(() => row('in', result)))).toContain('spawn');
    expect(failures([spawn, exit, spawn, row('out', result), initFailed, exit])).toContain('direction');
  });

  it('rejects a result that is not an error or does not name the missing conversation', () => {
    expect(failures(withResult({ is_error: false }))).toContain('isError');
    expect(failures(withResult({ is_error: undefined }))).toContain('isError');
    expect(failures(withResult({ errors: ['EACCES'] }))).toContain('errorMatch');
    expect(failures(withResult({ errors: undefined }))).toContain('errorMatch');
    expect(blankResumeStartupRejection(withResult({ errors: undefined, result: 'No conversation found with session ID: x' })).ok).toBe(true);
    // the engine’s refusal text is the evidence: a subtype or code alone, or one beside other error text, is not
    expect(failures(withResult({ subtype: 'no_conversation_found', errors: ['EACCES'] }))).toContain('errorMatch');
    expect(failures(withResult({ subtype: 'No conversation found', errors: undefined }))).toContain('errorMatch');
    expect(failures(withResult({ errors: ['no_conversation_found'] }))).toContain('errorMatch');
    expect(failures(withResult({ errors: undefined, error: 'NoConversationFound' }))).toContain('errorMatch');
    expect(journalFrameShapes(withResult({ subtype: 'no_conversation_found', errors: ['EACCES'] })).results[0]!.errorMatch).toBe(false);
    expect(blankResumeStartupRejection(withResult({ errors: undefined, error: 'No conversation found with session ID: x' })).ok).toBe(true);
  });

  it('rejects unknown, missing, nonzero or non-numeric turns, cost and usage', () => {
    expect(failures(withResult({ num_turns: undefined }))).toContain('numTurns');
    expect(failures(withResult({ num_turns: 1 }))).toContain('numTurns');
    expect(failures(withResult({ num_turns: '0' }))).toContain('numTurns');
    expect(failures(withResult({ total_cost_usd: undefined }))).toContain('totalCostUsd');
    expect(failures(withResult({ total_cost_usd: 0.0001 }))).toContain('totalCostUsd');
    expect(failures(withResult({ usage: undefined }))).toContain('usage');
    expect(failures(withResult({ usage: null }))).toContain('usage');
    expect(failures(withResult({ usage: [] }))).toContain('usage');
    expect(failures(withResult({ usage: {} }))).toContain('usage');
    expect(failures(withResult({ usage: { output_tokens: 0 } }))).toContain('usage');
    const noCreation = { ...usage, cache_creation_input_tokens: undefined };
    const noRead = { ...usage, cache_read_input_tokens: undefined };
    expect(failures(withResult({ usage: noCreation }))).toContain('usage');
    expect(failures(withResult({ usage: noRead }))).toContain('usage');
    expect(failures(withResult({ usage: { ...usage, cache_creation_input_tokens: null } }))).toContain('usage');
    expect(failures(withResult({ usage: { ...usage, cache_read_input_tokens: null } }))).toContain('usage');
    expect(failures(withResult({ usage: { ...usage, input_tokens: null } }))).toContain('usage');
    expect(failures(withResult({ usage: { ...usage, cache_creation_input_tokens: 3 } }))).toContain('usage');
    expect(blankResumeStartupRejection(withResult({ usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })).ok).toBe(true);
    expect(failures(withResult({ usage: { ...usage, input_tokens: 1 } }))).toContain('usage');
    expect(failures(withResult({ usage: { ...usage, cache_read_input_tokens: 5 } }))).toContain('usage');
    expect(failures(withResult({ usage: { ...usage, server_tool_use: { web_search_requests: 2 } } }))).toContain('usage');
    // the observed metadata: descriptive strings at the root, an empty iterations list, a null fallback credit — and nothing else
    for (const patch of [{ service_tier: 1 }, { service_tier: null }, { inference_geo: 0 }, { speed: false }, { iterations: undefined, extra: 0 }, { iterations: [{ input_tokens: 0 }] }, { iterations: {} }, { iterations: null }, { fallback_credit: 0 }, { fallback_credit: 'x' }, { fallback_credit: {} }]) {
      expect(failures(withResult({ usage: { ...usage, ...patch } })), JSON.stringify(patch)).toContain('usage');
    }
    expect(failures(withResult({ usage: { ...usage, unknown_counter: 0 } })), 'unknown root field').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, unknown_text: 'x' } })), 'unknown root string').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0, other: 0 } } })), 'unknown nested field').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0, ephemeral_9h_input_tokens: 0 } } })), 'unknown nested field').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, output_tokens_details: { thinking_tokens: 0, reasoning: 0 } } })), 'unknown nested field').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, output_tokens_details: { thinking_tokens: 1 } } })), 'thinking tokens').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, output_tokens_details: { thinking_tokens: null } } })), 'nested null counter').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, output_tokens_details: [] } })), 'nested array').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, server_tool_use: { web_search_requests: 0, web_fetch_requests: 1 } } })), 'server tool use').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 4 } } })), 'ephemeral cache').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, cache_creation: { ephemeral_1h_input_tokens: '0', ephemeral_5m_input_tokens: 0 } } })), 'ephemeral cache string').toContain('usage');
    expect(failures(withResult({ usage: { ...usage, input_tokens: '0' } }))).toContain('usage');
    expect(failures(withResult({ modelUsage: { 'claude-x': { inputTokens: 3, costUSD: 0.01 } } }))).toContain('modelUsage');
    expect(failures(withResult({ modelUsage: [] }))).toContain('modelUsage');
    expect(failures(withResult({ modelUsage: { 'claude-x': { inputTokens: 0, costUSD: 0 } } })), 'a model entry, even all zero').toContain('modelUsage');
    expect(failures(withResult({ modelUsage: undefined })), 'absent').toContain('modelUsage');
    expect(failures(withResult({ modelUsage: null }))).toContain('modelUsage');
  });

  it('rejects an assistant, stream or user frame anywhere, either direction', () => {
    expect(failures([...good(), row('in', { type: 'assistant', message: {} })])).toContain('modelFrames');
    expect(failures([row('in', { type: 'stream_event', event: {} }), ...good()])).toContain('modelFrames');
    expect(failures([...good(), row('out', { type: 'user', message: {} })])).toContain('userFrames');
    expect(failures([...good(), row('in', { type: 'user', message: {} })])).toContain('userFrames');
  });

  it('rejects a second spawn that did not write init_failed', () => {
    expect(failures([spawn, initFailed, exit, spawn, row('in', result), exit])).toContain('initFailed');
    expect(failures([spawn, exit, spawn, row('in', result), exit])).toContain('initFailed');
  });

  it('projects the frame in safe fields only: shapes and booleans, never content, arguments, environment or tokens', () => {
    const secret = 'sk-ant-AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789';
    const rows = [row('meta', { event: 'spawn', args: [`--token=${secret}`] }), row('in', { ...result, result: secret, errors: [secret, 'No conversation found'], env: { SECRET: secret }, usage: { ...usage, service_tier: secret } }), row('in', { type: 'assistant', message: { content: secret } })];
    const shapes = journalFrameShapes(rows);
    expect(JSON.stringify(shapes)).not.toContain(secret);
    expect(shapes.counts).toEqual({ 'in:result': 1, 'in:assistant': 1 });
    expect(shapes.results).toEqual([
      {
        spawn: 1,
        direction: 'in',
        subtype: 'error_during_execution',
        isError: true,
        numTurns: 0,
        totalCostUsd: 0,
        usage: {
          output_tokens_details: { thinking_tokens: 0 },
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          service_tier: '<string>',
          cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
          inference_geo: '<string>',
          iterations: '<array:0>',
          speed: '<string>',
          fallback_credit: null,
        },
        modelUsage: {},
        errorMatch: true,
        keys: ['type', 'subtype', 'is_error', 'errors', 'num_turns', 'total_cost_usd', 'usage', 'modelUsage', 'result', 'env'],
      },
    ]);
  });

  it('marks an absent field absent, and a non-object frame as no keys', () => {
    const [only] = journalFrameShapes([row('in', { type: 'result' }), row('in', 'text')]).results;
    expect(only).toMatchObject({ spawn: 0, subtype: null, isError: '<absent>', numTurns: '<absent>', totalCostUsd: '<absent>', usage: '<absent>', modelUsage: '<absent>', errorMatch: false, keys: ['type'] });
  });
});

describe('journalFilesOf / readJournalRows: a session’s journal in launch order, as the host orders it (Decision Log 42)', () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-journal-order-')));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const write = (name: string, at: string, frames: { direction: string; frame: unknown }[]) =>
    writeFileSync(join(dir, name), frames.map((row, index) => `${JSON.stringify({ seq: index, direction: row.direction, at, frame: row.frame })}\n`).join(''));
  const meta = (event: string) => ({ direction: 'meta', frame: { event } });

  it('orders launches by their first row’s time (not their ids) and a launch’s rotations numerically, and labels the failed resume spawn 2', () => {
    // the later launch has the lexicographically smaller id, and rotation 10 sorts before rotation 2 as text
    write('zzz.jsonl', '2026-10-17T10:00:00.000Z', [meta('spawn'), meta('exit')]);
    write('aaa.jsonl', '2026-10-17T11:00:00.000Z', [meta('spawn'), { direction: 'in', frame: { type: 'result', is_error: true, errors: ['No conversation found with session ID: x'], num_turns: 0, total_cost_usd: 0, modelUsage: {}, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }]);
    write('aaa.2.jsonl', '2026-10-17T11:00:01.000Z', [meta('init_failed')]);
    write('aaa.10.jsonl', '2026-10-17T11:00:02.000Z', [meta('exit')]);
    expect(journalFilesOf(dir).map((file) => file.slice(dir.length + 1))).toEqual(['zzz.jsonl', 'aaa.jsonl', 'aaa.2.jsonl', 'aaa.10.jsonl']);
    const rows = readJournalRows(dir);
    expect(rows.map((row) => (row.frame as { event?: string; type?: string }).event ?? (row.frame as { type?: string }).type)).toEqual(['spawn', 'exit', 'spawn', 'result', 'init_failed', 'exit']);
    expect(journalFrameShapes(rows).results[0]).toMatchObject({ spawn: 2 });
    expect(blankResumeStartupRejection(rows).failures).toEqual([]);
  });

  it('reads complete lines only, and answers nothing for a missing directory', () => {
    writeFileSync(join(dir, 'a.jsonl'), `${JSON.stringify({ seq: 0, direction: 'meta', at: '2026-10-17T10:00:00.000Z', frame: { event: 'spawn' } })}\n{"seq":1,"direction":"meta","at":"2026-10-17T10:00:01.0`);
    expect(readJournalRows(dir)).toHaveLength(1);
    expect(readJournalRows(join(dir, 'missing'))).toEqual([]);
  });
});

describe('forbiddenFrames: the assistant, stream and user frames no session of the transition scene may have, either direction (Decision Log 42)', () => {
  const row = (direction: string, frame: unknown) => ({ direction, frame });

  it('counts each kind in both directions, so an inbound user or an outbound model frame is seen', () => {
    expect(forbiddenFrames([row('in', { type: 'user' }), row('out', { type: 'assistant' }), row('in', { type: 'assistant' }), row('out', { type: 'stream_event' }), row('in', { type: 'stream_event' }), row('out', { type: 'user' })])).toEqual({ assistant: 2, streamEvent: 2, user: 2 });
  });

  it('counts neither results, control frames nor meta rows', () => {
    expect(forbiddenFrames([row('in', { type: 'result' }), row('out', { type: 'control_request' }), row('in', { type: 'system' }), row('meta', { type: 'user', event: 'spawn' }), row('in', 'user')])).toEqual({ assistant: 0, streamEvent: 0, user: 0 });
  });
});

describe('journalFrameShapes bounds: a large journal projects a sample and totals, never every frame', () => {
  const row = (direction: string, frame: unknown) => ({ direction, frame });

  it('keeps the first 8 results with the total, and 24 type buckets with the count of the rest', () => {
    const results = Array.from({ length: 12 }, () => row('in', { type: 'result', is_error: true }));
    const shapes = journalFrameShapes(results);
    expect(shapes.results).toHaveLength(8);
    expect(shapes.resultsTotal).toBe(12);
    expect(shapes.counts['in:result']).toBe(12);
    const typed = Array.from({ length: 40 }, (_, index) => row('in', { type: `t${index}` }));
    const many = journalFrameShapes([...typed, row('in', { type: 't0' })]);
    expect(Object.keys(many.counts)).toHaveLength(24);
    expect(many.counts['in:t0']).toBe(2);
    expect(many.otherFrames).toBe(16);
  });
});

describe('isRetainedScratch: the scratch files a scene scans as retainable', () => {
  it('scans profile, config, journal, host log and fixture safe logs', () => {
    for (const path of ['ud/engine-host/journal/s1/0001.jsonl', 'ud/supervisor/host.log', 'ud/claude-config/.claude.json', 'oauth-series.jsonl', 'calls.jsonl', 'timeline.json', 'ud/Local Storage/leveldb/000003.log']) {
      expect(isRetainedScratch(path), path).toBe(true);
    }
  });

  it('never reads the host token, the raw open log, a fixture’s secrets inventory or a sealed record', () => {
    for (const path of ['ud/supervisor/host.token', 'open.log', 'oauth-series-secrets.jsonl', 'oauth-other-secrets.jsonl', 'ud/connectors/oauth/5f0c7d2e-8a4b-4c1e-9d2f-0123456789ab.sealed']) {
      expect(isRetainedScratch(path), path).toBe(false);
    }
  });
});

describe('bearerCrossings: a bearer presented where it was not issued', () => {
  it('answers none when each server saw only its own tokens, or none', () => {
    expect(bearerCrossings([{ name: 'series', issued: ['a1', 'a2'], presented: ['a2', 'a1'] }, { name: 'other', issued: [], presented: [] }])).toEqual([]);
  });

  it('names where a token was presented and which server issued it, or null when none did', () => {
    const crossings = bearerCrossings([
      { name: 'series', issued: ['a1'], presented: ['a1', 'zz'] },
      { name: 'other', issued: ['b1'], presented: ['a1', 'b1'] },
    ]);
    expect(crossings).toEqual([{ at: 'series', issuedBy: null }, { at: 'other', issuedBy: 'series' }]);
  });
});

describe('the scenes’ page variants', () => {
  const live = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signups, live</title></head>
<body>
<h1>Signups, live</h1>
<script>
const tool = { server: "fixture", tool: "read_series" };
</script>
</body></html>
`;

  it('re-points H’s page at another server under another title, nothing else changed', () => {
    const other = pageVariant(live, { server: 'other', title: 'Signups, other' });
    expect(other).toBe(live.replace('<title>Signups, live</title>', '<title>Signups, other</title>').replace('<h1>Signups, live</h1>', '<h1>Signups, other</h1>').replace('server: "fixture"', 'server: "other"'));
  });

  it('refuses a page whose title or server is not there exactly once', () => {
    expect(() => pageVariant(live.replace('<h1>Signups, live</h1>', ''), { server: 'other', title: 'x' })).toThrow(/exactly once/);
    expect(() => pageVariant(`${live}${live}`, { server: 'other', title: 'x' })).toThrow(/exactly once/);
    expect(() => pageVariant(live, { server: 'other', title: 'x' }, { server: 'nope', title: 'Signups, live' })).toThrow(/exactly once/);
  });

  it('writes a page that declares one tool and calls it once per click, showing outcomes as H’s page does', () => {
    const html = oncePageHtml({ server: 'fixture', tool: 'read_series', title: 'Signups, once' });
    expect(html).toContain('<title>Signups, once</title>');
    expect(html).toContain('const tool = { server: "fixture", tool: "read_series" };');
    expect(html).toContain('mawsConnectors.declare([tool])');
    expect(html).toContain("mawsConnectors.call({ ...tool, args: { series: 'signups' } })");
    expect(html).toContain('<button id="call" type="button">');
    expect(html).not.toContain('mawsConnectors.watch');
    expect(oncePageHtml({ server: 'a"b', tool: '</script>', title: 'T' })).toContain('const tool = { server: "a\\"b", tool: "<\\/script>" };');
  });
});

describe('heldFate: what became of one held call once its hold was lifted', () => {
  const held = { pid: 41, rpcId: 7 };
  const entries = [
    { pid: 41, method: 'tools/call', rpcId: 7 },
    { pid: 41, method: null, event: 'released', rpcId: 6 }, // another call's release
    { pid: 42, method: null, event: 'released', rpcId: 7 }, // another instance's
  ];

  it('is released only by that instance’s release of that call', () => {
    expect(heldFate([...entries, { pid: 41, method: null, event: 'released', rpcId: 7 }], held, true)).toBe('released');
    expect(heldFate([...entries, { pid: 41, method: null, event: 'released', rpcId: 7 }], held, false)).toBe('released');
  });

  it('is torn down when its instance is gone without releasing it', () => {
    expect(heldFate(entries, held, false)).toBe('teardown');
  });

  it('is still pending while its instance lives and has not released it: a broken release cannot pass', () => {
    expect(heldFate(entries, held, true)).toBe('pending');
    expect(heldFate([], held, true)).toBe('pending');
  });
});

describe('attachIfClean: a screenshot attached only once the live documents scanned clean', () => {
  const deps = (over: Partial<Parameters<typeof attachIfClean>[0]> = {}) => {
    const capture = vi.fn(async () => Buffer.from('png'));
    const attach = vi.fn<(body: Buffer) => Promise<void>>(async () => {});
    return { capture, attach, all: { read: async () => ['<html>sheet</html>', '<html>page</html>'], scan: () => ({}), capture, attach, ...over } };
  };

  it('captures and attaches when every document is clean', async () => {
    const { capture, attach, all } = deps();
    await expect(attachIfClean(all)).resolves.toEqual({ documents: 2 });
    expect(capture).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenCalledWith(Buffer.from('png'));
  });

  it('never captures or attaches when a document carries a secret, reporting kinds and counts only', async () => {
    const secret = 'synthetic-access-token-value';
    const { capture, attach, all } = deps({ read: async () => [`<p>${secret}</p>`], scan: (texts) => (texts.some((text) => text.includes(secret)) ? { accessToken: 1 } : {}) });
    const failure = await attachIfClean(all).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('accessToken: 1');
    expect((failure as Error).message).not.toContain(secret);
    expect(capture).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it('never certifies a read that failed, read nothing, or read an empty document', async () => {
    for (const read of [async () => Promise.reject(new Error('frame detached')), async () => [], async () => ['<html>sheet</html>', '']]) {
      const { capture, attach, all } = deps({ read });
      await expect(attachIfClean(all)).rejects.toThrow();
      expect(capture).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
    }
  });
});

describe('scanScratchTree: every retainable scratch file read in bounded chunks, every gap a failure', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-scratch-scan-')));
  });
  afterEach(() => {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  });
  const SECRET = 'synthetic-refresh-token-0123456789';
  const clean = (text: string) => !text.includes(SECRET);

  it('reads every retainable file, skipping only the excluded ones, and finds a value across a chunk boundary', () => {
    mkdirSync(join(root, 'ud', 'supervisor'), { recursive: true });
    writeFileSync(join(root, 'ud', 'supervisor', 'host.log'), 'quiet');
    writeFileSync(join(root, 'ud', 'supervisor', 'host.token'), SECRET); // excluded, never read
    writeFileSync(join(root, 'open.log'), SECRET); // excluded
    writeFileSync(join(root, 'big.log'), `${'x'.repeat(1_000)}${SECRET}${'y'.repeat(1_000)}`);
    const scan = scanScratchTree(root, clean, { chunkBytes: 1_010, overlapBytes: 64 });
    expect(scan).toEqual({ files: 2, bytes: 5 + 2_000 + SECRET.length, gone: [], failures: [], dirty: ['big.log'] });
  });

  it('reads a file larger than any one chunk whole, in bounded reads', () => {
    writeFileSync(join(root, 'large.bin'), Buffer.alloc(10_000, 0x61));
    const reads: number[] = [];
    const fs: ScratchFs = { ...nodeScratchFs, read: (path, position, length) => (reads.push(length), nodeScratchFs.read(path, position, length)) };
    expect(scanScratchTree(root, clean, { fs, chunkBytes: 4_096, overlapBytes: 64 })).toMatchObject({ files: 1, bytes: 10_000, failures: [], dirty: [] });
    expect(Math.max(...reads)).toBeLessThanOrEqual(4_096);
  });

  it('fails a file or directory it cannot read', () => {
    writeFileSync(join(root, 'locked.log'), 'x');
    chmodSync(join(root, 'locked.log'), 0o000);
    mkdirSync(join(root, 'shut'));
    chmodSync(join(root, 'shut'), 0o000);
    try {
      const scan = scanScratchTree(root, clean);
      expect(scan.failures.map((failure) => failure.path).sort()).toEqual(['locked.log', 'shut']);
      expect(scan.failures.every((failure) => failure.code === 'EACCES')).toBe(true);
    } finally {
      chmodSync(join(root, 'locked.log'), 0o600);
      chmodSync(join(root, 'shut'), 0o700);
    }
  });

  it('counts a file gone between listing and reading as gone, not as read or failed; any other error fails', () => {
    writeFileSync(join(root, 'a.log'), 'x');
    writeFileSync(join(root, 'b.log'), 'x');
    const error = (code: string) => Object.assign(new Error(code), { code });
    const fs: ScratchFs = {
      ...nodeScratchFs,
      read: (path, position, length) => {
        if (path.endsWith('a.log')) throw error('ENOENT');
        if (path.endsWith('b.log')) throw error('EIO');
        return nodeScratchFs.read(path, position, length);
      },
    };
    expect(scanScratchTree(root, clean, { fs })).toEqual({ files: 0, bytes: 0, gone: ['a.log'], failures: [{ path: 'b.log', code: 'EIO' }], dirty: [] });
  });

  it('fails a root it cannot list', () => {
    expect(scanScratchTree(join(root, 'missing'), clean).failures).toEqual([{ path: '.', code: 'ENOENT' }]);
  });
});

// P3-HD panel correction: the probe's launcher names node's path in shell source; JSON quoting would still expand it
describe('shellQuoted: a value spelled for /bin/sh as one literal word', () => {
  it('suppresses expansion, substitution and an embedded quote', async () => {
    const { execFileSync } = await import('node:child_process');
    const scratch = mkdtempSync(join(tmpdir(), 'maws-shell-quote-'));
    const marker = join(scratch, 'expanded');
    for (const value of [`/opt/$(touch ${marker})/node`, `/opt/\`touch ${marker}\`/node`, "/opt/it's/$HOME/node", '/plain/node']) {
      expect(execFileSync('/bin/sh', ['-c', `printf %s ${shellQuoted(value)}`], { encoding: 'utf8' }), value).toBe(value);
    }
    expect(existsSync(marker)).toBe(false);
    rmSync(scratch, { recursive: true, force: true });
  });
});
