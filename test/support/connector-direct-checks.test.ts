// P3-HD M4b: the pure checks route D's integrated scenes (e2e/connectors-direct.spec.ts) rest their custody, listener,
// sealed-record, journal, bearer and page claims on (e2e/support/connector-direct-checks.ts). No app, engine, socket or
// fixture process: each check is driven with the values a scene would read.
import { describe, expect, it } from 'vitest';
import {
  addedListeners, bearerCrossings, custodyProblems, isRetainedScratch, journalTurns, loopbackPort, oncePageHtml, pageVariant, plaintextHits, readSealedText, SEALED_FORMAT,
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
