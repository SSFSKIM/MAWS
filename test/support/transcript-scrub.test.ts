// The live check's recording step (e2e/sheet-live.rig.ts): a transcript scrubbed as test/fixtures/lane-a/README.md
// describes, with the account's and the machine's names taken out of free text as well as metadata.
import { describe, expect, it } from 'vitest';
import { remainingNames, scrubTranscript, type ScrubNames } from './transcript-scrub';

const NAMES: ScrubNames = { project: '/private/tmp/qsl.Ab12/work', scratch: '/private/tmp/qsl.Ab12', home: '/Users/kim', account: 'kim', host: 'Kims-Studio.local' };
const row = (fields: Record<string, unknown>) => ({ uuid: 'u', parentUuid: null, ...fields });

describe('scrubTranscript', () => {
  it('drops the bookkeeping rows and the environment’s attachments, re-chaining each child past them', () => {
    const out = scrubTranscript([
      row({ uuid: 'a', type: 'user', message: { role: 'user', content: 'hi' } }),
      row({ uuid: 'b', parentUuid: 'a', type: 'attachment', attachment: { type: 'environment', content: 'cwd …' } }),
      row({ uuid: 'c', parentUuid: 'b', type: 'api-request', body: {} }),
      { type: 'last-prompt', lastPrompt: 'hi' }, // no uuid: dropped, and never a link of the chain
      row({ uuid: 'd', parentUuid: 'c', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }),
      row({ uuid: 'e', parentUuid: 'd', type: 'attachment', attachment: { type: 'hook_additional_context', hookName: 'prompt.submit', content: ['<sheet-delivery>{}</sheet-delivery>'] } }),
    ], NAMES);
    expect(out.map((r) => [r.uuid, r.parentUuid])).toEqual([['a', null], ['d', 'a'], ['e', 'd']]);
  });

  it('rewrites the paths, the account and the machine in every string, free text included', () => {
    const [out] = scrubTranscript([row({
      type: 'user', cwd: '/private/tmp/qsl.Ab12/work',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'drwxr-xr-x  5 kim  staff  160 Nov 27 22:04 .\n-rw-r--r--  1 kim  staff  122 README.md\nkim@Kims-Studio.local:/Users/kim/x' }] },
      toolUseResult: { stdout: 'total 8\n-rw-r--r--  1 kim  staff  38 routes.csv\nsee /private/tmp/qsl.Ab12/s/bridge on Kims-Studio' },
    })], NAMES);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/kim|Kims-Studio|qsl\.Ab12|private\/tmp/);
    expect(out!.cwd).toBe('/work/demo');
    expect(text).toContain('1 me  staff  122 README.md');
    expect(text).toContain('me@studio:/Users/me/x');
    expect(text).toContain('see /work/scratch/s/bridge on studio');
  });

  it('keeps a word that only contains the account’s name, and replaces the name standing alone', () => {
    const [out] = scrubTranscript([row({ type: 'assistant', message: { content: [{ type: 'text', text: 'kimchi for kim, Kim.' }] } })], NAMES);
    expect(JSON.stringify(out)).toContain('kimchi for me, Kim.');
  });

  it('replaces signatures, request ids and hook commands', () => {
    const [out] = scrubTranscript([row({ type: 'system', requestId: 'req_1', requestRef: 'r-2', message: { content: [{ type: 'thinking', signature: 'sig' }] }, hookInfos: [{ command: '/Users/kim/.claude/hooks/x.sh' }, { command: 'python3 y.py' }, { command: '/Users/kim/.claude/hooks/x.sh' }] })], NAMES);
    expect(out).toMatchObject({ requestId: 'req_scrubbed', requestRef: 'req_scrubbed', message: { content: [{ signature: 'scrubbed' }] }, hookInfos: [{ command: 'hook-1' }, { command: 'hook-2' }, { command: 'hook-1' }] });
  });
});

describe('remainingNames', () => {
  it('names each place the account, the machine or a scratch path still stands', () => {
    expect(remainingNames('{"a":"ok"}', NAMES)).toEqual([]);
    expect(remainingNames('{"a":"by kim on Kims-Studio.local in /private/tmp/qsl.Ab12"}', NAMES)).toEqual(['kim', 'Kims-Studio', 'qsl.Ab12']);
  });
});
