// The `claude` export over a system's document (D12; A's export service registers it at its M7): Claude's files from
// the system as it stands, `tokens.json` in Claude's list grammar and `README.md` from the law.
import { describe, expect, it } from 'vitest';
import { newDoc } from '../yjs';
import { claudeExportFiles } from './export';
import complete from './fixtures/complete.tokens.json';
import { fromClaude } from './claude';
import { validateClaudeTokens } from './claude-grammar';
import { writeSystem } from './model';
import { parseTokens, serializeTokens } from './tokens';

const LAW = '# Harbor\n\n## 0. Persona\npersona: a harbour pilot\n';

describe('the claude export of a system’s document', () => {
  it('writes Claude’s files from the system as it stands, which import back', () => {
    const doc = newDoc();
    writeSystem(doc, { 'DESIGN.md': LAW, 'tokens.tokens.json': serializeTokens(parseTokens(complete).tokens!) }, { route: 'derived', at: 0 });
    const files = claudeExportFiles(doc);
    expect(Object.keys(files).sort()).toEqual(['README.md', 'tokens.json']);
    expect(files['README.md']).toBe(LAW);
    expect(validateClaudeTokens(JSON.parse(files['tokens.json']!))).toEqual([]);
    expect(fromClaude(files).tokens).not.toBeNull();
  });

  it('refuses a document that holds no system yet', () => {
    expect(() => claudeExportFiles(newDoc())).toThrow(/holds no design system/);
  });
});
