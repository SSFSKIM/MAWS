import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeCommand, HelperEventSchema, isCaptureEvent, LineSplitter } from './protocol';

// One line per event kind, as the helper writes them (M1; `native/voice-helper/main.swift` is the source of truth).
const FIXTURE = resolve(__dirname, '../../../test/fixtures/voice/helper-lines.jsonl');
const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
const ID = '3f2b8c1e-6d4a-4f7b-9a1e-2c5d8e7f6a90';

describe('voice helper protocol lines parse', () => {
  it('parses every fixture line as its own kind, one line per kind', () => {
    const kinds = lines.map((line) => HelperEventSchema.parse(JSON.parse(line)).type);
    expect(kinds).toEqual(['ready', 'probe', 'permission', 'started', 'partial', 'final', 'cancelled', 'error']);
  });

  it('keeps the fields the helper writes', () => {
    const [ready, probe, , , , final, , error] = lines.map((line) => HelperEventSchema.parse(JSON.parse(line)));
    expect(ready).toEqual({ type: 'ready', protocol: 1 });
    expect(probe).toMatchObject({ type: 'probe', systemLocale: 'ko-KR', locale: 'en-US', supportsOnDevice: true, permission: { microphone: 'authorized', speech: 'notDetermined' } });
    expect(final).toEqual({ type: 'final', id: ID, text: 'Hello world.', timedOut: false });
    expect(error).toMatchObject({ type: 'error', id: ID, code: 'microphone_denied' });
  });

  it('refuses an unknown type, an unknown field, an unknown error code and another protocol version', () => {
    expect(HelperEventSchema.safeParse({ type: 'stopped', id: ID }).success).toBe(false);
    expect(HelperEventSchema.safeParse({ type: 'partial', id: ID, text: 'x', confidence: 0.4 }).success).toBe(false);
    expect(HelperEventSchema.safeParse({ type: 'error', id: ID, code: 'teapot', message: '' }).success).toBe(false);
    expect(HelperEventSchema.safeParse({ type: 'ready', protocol: 2 }).success).toBe(false);
  });

  it('takes an error the helper could not attribute to a capture (a malformed command)', () => {
    expect(HelperEventSchema.safeParse({ type: 'error', id: null, code: 'bad_request', message: 'Unparseable command line.' }).success).toBe(true);
  });

  it('tells capture events from the ready and probe answers', () => {
    const events = lines.map((line) => HelperEventSchema.parse(JSON.parse(line)));
    expect(events.filter(isCaptureEvent).map((event) => event.type)).toEqual(['permission', 'started', 'partial', 'final', 'cancelled', 'error']);
  });

  it('writes each command as one JSON line in the shape the helper reads', () => {
    expect(encodeCommand({ cmd: 'probe', locale: null })).toBe('{"cmd":"probe","locale":null}\n');
    expect(encodeCommand({ cmd: 'start', id: ID, locale: 'en-US' })).toBe(`{"cmd":"start","id":"${ID}","locale":"en-US"}\n`);
    expect(encodeCommand({ cmd: 'stop', id: ID })).toBe(`{"cmd":"stop","id":"${ID}"}\n`);
    expect(encodeCommand({ cmd: 'cancel', id: ID })).toBe(`{"cmd":"cancel","id":"${ID}"}\n`);
    expect(encodeCommand({ cmd: 'quit' })).toBe('{"cmd":"quit"}\n');
  });
});

describe('the helper line splitter', () => {
  const split = (max = 16) => {
    const out: string[] = [];
    const overlong: number[] = [];
    const splitter = new LineSplitter(max, (line) => out.push(line), (bytes) => overlong.push(bytes));
    return { splitter, out, overlong };
  };

  it('joins lines across chunks and keeps a partial line until its newline', () => {
    const { splitter, out } = split();
    splitter.push('{"a"');
    splitter.push(':1}\n{"b":2}\n{"c"');
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
    splitter.push(':3}\n');
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('drops a line longer than its bound without buffering it, and resumes at the next newline', () => {
    const { splitter, out, overlong } = split(8);
    splitter.push('0123456789');
    splitter.push('abcdefghij');
    splitter.push('klm\n{"ok":1}\n');
    expect(out).toEqual(['{"ok":1}']);
    expect(overlong).toEqual([23]);
  });

  it('skips empty lines and a carriage return before the newline', () => {
    const { splitter, out } = split();
    splitter.push('\n{"a":1}\r\n\n');
    expect(out).toEqual(['{"a":1}']);
  });
});
