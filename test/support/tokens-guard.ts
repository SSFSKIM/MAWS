// X7 guard: renderer sources name colours only through tokens (`var(--token)` or the token utilities of app.css).
// `styles/tokens.css` is the one file allowed to hold literal colour values.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const RENDERER_DIR = join(__dirname, '../../src/renderer');
const TOKENS_FILE = join('styles', 'tokens.css');
const SOURCE_EXTENSIONS = /\.(ts|tsx|css)$/;

const RULES: { rule: string; pattern: RegExp }[] = [
  { rule: 'hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { rule: 'colour function', pattern: /\b(?:rgba?|hsl|oklch)\(/g },
  {
    rule: 'palette class',
    pattern:
      /\b(?:bg|text|border|fill|stroke|ring|outline|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g,
  },
];

export interface TokenViolation {
  file: string;
  line: number;
  rule: string;
  match: string;
}

export function findTokenViolations(source: string, file = '<inline>'): TokenViolation[] {
  const violations: TokenViolation[] = [];
  source.split('\n').forEach((text, index) => {
    for (const { rule, pattern } of RULES) {
      for (const match of text.matchAll(pattern)) {
        violations.push({ file, line: index + 1, rule, match: match[0] });
      }
    }
  });
  return violations;
}

export function scanRendererSources(root = RENDERER_DIR): TokenViolation[] {
  return listSources(root)
    .filter((file) => relative(root, file) !== join('src', TOKENS_FILE))
    .flatMap((file) => findTokenViolations(readFileSync(file, 'utf8'), relative(root, file).split(sep).join('/')));
}

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(path);
    return SOURCE_EXTENSIONS.test(entry.name) ? [path] : [];
  });
}
