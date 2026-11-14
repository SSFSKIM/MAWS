// A slash command's output written back in the engine's own tags (UX wave U3, UC-2, class `command`; the U3a document,
// Interfaces C and Acceptance 6), as the live normaliser and the disk backfill both draw it: the inverse of
// `localCommandParts` for what it reads. Outputs are invented.
import { describe, expect, it } from 'vitest';
import { localCommandParts, localCommandText } from './engine-markers';

describe('localCommandText', () => {
  it('an output on stdout alone, on stderr alone, and on both: each in the tag that says which, stdout first', () => {
    expect(localCommandText([{ stdout: 'Set model to demo', stderr: '' }])).toBe('<local-command-stdout>Set model to demo</local-command-stdout>');
    expect(localCommandText([{ stdout: '', stderr: 'Unknown model: demo' }])).toBe('<local-command-stderr>Unknown model: demo</local-command-stderr>');
    expect(localCommandText([{ stdout: 'Partly done', stderr: 'One step failed' }])).toBe('<local-command-stdout>Partly done</local-command-stdout>\n<local-command-stderr>One step failed</local-command-stderr>');
  });

  it('a command with no output at all is an empty stdout tag, never no text', () => {
    expect(localCommandText([{ stdout: '', stderr: '' }])).toBe('<local-command-stdout></local-command-stdout>');
  });

  it('several outputs of one carrier, one line between them', () => {
    expect(localCommandText([{ stdout: 'first', stderr: '' }, { stdout: '', stderr: 'second' }])).toBe('<local-command-stdout>first</local-command-stdout>\n<local-command-stderr>second</local-command-stderr>');
  });

  it('reads back as the parts it was written from', () => {
    for (const parts of [{ stdout: 'a\nb', stderr: '' }, { stdout: '', stderr: 'c' }, { stdout: 'd', stderr: 'e' }]) expect(localCommandParts(localCommandText([parts]))).toEqual(parts);
  });
});
