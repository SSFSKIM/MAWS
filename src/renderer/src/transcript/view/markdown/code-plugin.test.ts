import { describe, expect, it } from 'vitest';
import { createTranscriptCodePlugin, type HighlightResult } from './code-plugin';

const THEMES = ['github-light', 'github-dark'] as const;

function highlight(plugin: ReturnType<typeof createTranscriptCodePlugin>, code: string, language = 'ts'): Promise<HighlightResult> {
  return new Promise((resolve) => {
    const ready = plugin.highlight({ code, language, themes: [...THEMES] }, resolve);
    if (ready) resolve(ready);
  });
}

const text = (result: HighlightResult) => result.tokens.map((line) => line.map((token) => token.content).join('')).join('\n');

// Two blocks of equal length that share their first and last hundred characters: the key @streamdown/code 1.1.1
// uses (language, themes, length, head, tail) cannot tell them apart.
const padding = '// '.padEnd(100, 'x');
const blockA = `${padding}\nconst a = 1;\n${padding}`;
const blockB = `${padding}\nlet  b = 2;;\n${padding}`;

describe('code highlight cache', () => {
  it('highlights two equal-length blocks sharing their first and last hundred characters differently', async () => {
    expect(blockA.length).toBe(blockB.length);
    const plugin = createTranscriptCodePlugin({ themes: [...THEMES] });
    const a = await highlight(plugin, blockA);
    const b = await highlight(plugin, blockB);
    expect(text(a)).toBe(blockA);
    expect(text(b)).toBe(blockB);
  });

  it('answers synchronously from the cache once a block has been highlighted', async () => {
    const plugin = createTranscriptCodePlugin({ themes: [...THEMES] });
    const first = await highlight(plugin, 'const x = 1;');
    expect(plugin.highlight({ code: 'const x = 1;', language: 'ts', themes: [...THEMES] })).toBe(first);
  });

  it('returns null first and calls every waiting callback once the tokens are ready', async () => {
    const plugin = createTranscriptCodePlugin({ themes: [...THEMES] });
    const results: HighlightResult[] = [];
    const done = new Promise<void>((resolve) => {
      const waiter = () => (result: HighlightResult) => {
        results.push(result);
        if (results.length === 2) resolve();
      };
      expect(plugin.highlight({ code: 'print(1)', language: 'py', themes: [...THEMES] }, waiter())).toBeNull();
      expect(plugin.highlight({ code: 'print(1)', language: 'py', themes: [...THEMES] }, waiter())).toBeNull();
    });
    await done;
    expect(results[0]).toBe(results[1]);
  });

  it('highlights an unknown language as plain text and resolves aliases', async () => {
    const plugin = createTranscriptCodePlugin({ themes: [...THEMES] });
    expect(plugin.supportsLanguage('sh')).toBe(true);
    expect(plugin.supportsLanguage('not-a-language')).toBe(false);
    const unknown = await highlight(plugin, 'plain words', 'not-a-language');
    expect(text(unknown)).toBe('plain words');
  });
});
