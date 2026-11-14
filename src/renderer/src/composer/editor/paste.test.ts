import { describe, expect, it } from 'vitest';
import { classifyFile, classifyText, mentionPath, PASTE_INLINE_MAX_CHARS } from './paste';

const MiB = 1024 * 1024;
const file = (name: string, type: string, size = 100) => ({ name, type, size });

describe('paste and drop classify by threshold, type and path', () => {
  // UX wave U4a M6 (l3-input-09; decision 23): a paste stays text whatever its line count; only one past 20,000 characters is a chip
  it('keeps a paste inline up to 20,000 characters, whatever its line count, and makes an atom beyond', () => {
    expect(PASTE_INLINE_MAX_CHARS).toBe(20_000);
    expect(classifyText('x'.repeat(5000))).toBe('inline');
    expect(classifyText(Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n'))).toBe('inline');
    expect(classifyText('a\n'.repeat(10_000))).toBe('inline'); // 20,000 characters on 10,001 lines
    expect(classifyText('x'.repeat(20_000))).toBe('inline');
    expect(classifyText('x'.repeat(20_001))).toBe('atom');
  });

  it('attaches the four image types the API reads as bytes, and PDFs', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) expect(classifyFile(file('a', type), '')).toEqual({ kind: 'image' });
    expect(classifyFile(file('a.pdf', 'application/pdf'), '/x/a.pdf')).toEqual({ kind: 'pdf' });
  });

  it('never sends HEIC, BMP or TIFF as bytes: a path is mentioned, a pathless one refused', () => {
    for (const [name, type] of [['a.heic', 'image/heic'], ['a.bmp', 'image/bmp'], ['a.tiff', 'image/tiff'], ['a.heif', 'image/heif']]) {
      expect(classifyFile(file(name, type), `/pics/${name}`)).toEqual({ kind: 'mention', path: `/pics/${name}` });
      const refused = classifyFile(file(name, type), '');
      expect(refused.kind).toBe('refused');
      expect(refused.kind === 'refused' && refused.reason).toMatch(/PNG, JPEG, GIF or WebP/);
    }
  });

  it('mentions every other file that has a path, directories included', () => {
    expect(classifyFile(file('notes.md', 'text/markdown'), '/repo/notes.md')).toEqual({ kind: 'mention', path: '/repo/notes.md' });
    expect(classifyFile(file('src', ''), '/repo/src')).toEqual({ kind: 'mention', path: '/repo/src' });
  });

  it('reads a pathless file as text up to 1 MiB and refuses it beyond', () => {
    expect(classifyFile(file('log.txt', 'text/plain', MiB), '')).toEqual({ kind: 'text' });
    expect(classifyFile(file('log.txt', 'text/plain', MiB + 1), '').kind).toBe('refused');
  });

  it('refuses a PDF over 32 MiB and an image over 20 MiB unless there is a path to mention', () => {
    expect(classifyFile(file('big.pdf', 'application/pdf', 32 * MiB + 1), '').kind).toBe('refused');
    expect(classifyFile(file('big.pdf', 'application/pdf', 32 * MiB + 1), '/x/big.pdf')).toEqual({ kind: 'mention', path: '/x/big.pdf' });
    expect(classifyFile(file('big.png', 'image/png', 20 * MiB + 1), '').kind).toBe('refused');
  });

  it('mentions a path relative to cwd when inside it and absolute otherwise', () => {
    expect(mentionPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
    expect(mentionPath('/repo', '/repo')).toBe('/repo');
    expect(mentionPath('/repository/a.ts', '/repo')).toBe('/repository/a.ts');
    expect(mentionPath('/elsewhere/b.ts', '/repo/')).toBe('/elsewhere/b.ts');
  });
});
