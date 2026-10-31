import { describe, expect, it } from 'vitest';
import { HostStreamDecoder, HostStreamError, controlLine, stdinRecord, type HostItem } from './protocol';

const bytes = (s: string) => Buffer.from(s, 'utf8');

describe('the session host stream', () => {
  it('decodes control lines and length-prefixed records across any chunking', () => {
    const stream = Buffer.concat([
      bytes('{"t":"hello","protocol":1}\n'),
      bytes('{"t":"out","seq":1,"len":11}\n'),
      bytes('hello\nworld'), // a record's bytes may hold newlines: its length frames it
      bytes('{"t":"err","seq":2,"len":0}\n'),
      bytes('{"t":"caughtUp","lastSeq":2,"gap":null}\n'),
    ]);
    const whole = new HostStreamDecoder().push(stream);
    expect(whole).toEqual<HostItem[]>([
      { kind: 'control', message: { t: 'hello', protocol: 1 } },
      { kind: 'record', stream: 'out', seq: 1, data: bytes('hello\nworld') },
      { kind: 'record', stream: 'err', seq: 2, data: Buffer.alloc(0) },
      { kind: 'control', message: { t: 'caughtUp', lastSeq: 2, gap: null } },
    ]);
    for (const size of [1, 2, 3, 7, 13]) {
      const decoder = new HostStreamDecoder();
      const items: HostItem[] = [];
      for (let at = 0; at < stream.length; at += size) items.push(...decoder.push(stream.subarray(at, at + size)));
      expect(items, `chunks of ${size}`).toEqual(whole);
    }
  });

  it('refuses a record over the frame cap and a line that is not JSON', () => {
    expect(() => new HostStreamDecoder(100).push(bytes('{"t":"out","seq":1,"len":200}\n'))).toThrow(HostStreamError);
    expect(() => new HostStreamDecoder(100).push(bytes('x'.repeat(101)))).toThrow(HostStreamError);
    expect(() => new HostStreamDecoder().push(bytes('not json\n'))).toThrow(HostStreamError);
  });

  it('encodes a control line and a stdin record as one buffer each', () => {
    expect(controlLine({ t: 'attach', role: 'writer', fence: 2 }).toString()).toBe('{"t":"attach","role":"writer","fence":2}\n');
    const record = stdinRecord(10, bytes('{"type":"user"}\n'));
    expect(record.toString()).toBe('{"t":"stdin","offset":10,"len":16}\n{"type":"user"}\n');
  });
});
