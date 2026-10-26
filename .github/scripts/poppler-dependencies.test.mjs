// Static dependency audit plus Playwright's real per-group collection, never a test launch. The collection case
// belongs on the static gate; scanner regressions can run alone with --test-name-pattern='scanner'.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import ts from 'typescript';
import { listSelection, readScript } from './e2e-default-specs.mjs';
import { planOf } from './gate-plan.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Poppler's CLI family, not just the four executables today's tests use. POPPLER also catches a path assembled into
// a command. Tokens exclude comments, so a support module that merely describes pdftotext's output is not a user.
const tool = /\b(?:poppler|pdfattach|pdfdetach|pdffonts|pdfimages|pdfinfo|pdfseparate|pdfsig|pdftocairo|pdftohtml|pdftoppm|pdftops|pdftotext|pdfunite)\b/i;
const code = /\.(?:[cm]?js|jsx|ts|tsx|sh|py)$/;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

function scan(directory) {
  const graph = new Map();
  function visit(file) {
    if (graph.has(file)) return;
    const source = readFileSync(file, 'utf8');
    const edges = new Set();
    const node = { direct: false, edges };
    graph.set(file, node);
    if (/\.(?:sh|py)$/.test(file)) {
      node.direct = tool.test(source.replace(/^\s*#.*$/gm, ''));
      return;
    }
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
    while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) node.direct ||= tool.test(scanner.getTokenText());
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function imports(ast) {
      // Follow relative imports/re-exports and relative fixture paths (new URL/readFile/require/import literals).
      if (ts.isStringLiteralLike(ast) && ast.text.startsWith('.')) {
        const target = resolve(dirname(file), ast.text);
        const module = ts.resolveModuleName(ast.text, file, { moduleResolution: ts.ModuleResolutionKind.Node10 }, ts.sys).resolvedModule?.resolvedFileName;
        const found = existsSync(target) && statSync(target).isFile() ? target : module;
        if (found && code.test(found) && !relative(directory, found).startsWith('..')) edges.add(found);
      }
      ts.forEachChild(ast, imports);
    }
    imports(tree);
    for (const next of edges) visit(next);
  }
  const files = walk(join(directory, 'e2e')).filter((file) => code.test(file));
  for (const file of files) visit(file);
  function reaches(file, seen = new Set()) {
    if (seen.has(file)) return false;
    seen.add(file);
    const node = graph.get(file);
    return Boolean(node && (node.direct || [...node.edges].some((next) => reaches(next, seen))));
  }
  const specs = files.filter((file) => /\.spec\.[cm]?[jt]sx?$/.test(file) && reaches(file));
  // A new tool-using fixture that the literal import/path walk cannot assign is an error, not a silent omission.
  const reachable = new Set();
  function mark(file) {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const next of graph.get(file)?.edges ?? []) mark(next);
  }
  for (const spec of specs) mark(spec);
  const unassigned = [...graph].filter(([file, node]) => node.direct && !reachable.has(file)).map(([file]) => relative(directory, file));
  assert.deepEqual(unassigned, [], 'tool-using sources need a traceable spec import or fixture path');
  return specs.map((file) => relative(directory, file)).sort();
}

test('scanner follows shared support re-exports, dynamic imports and fixtures, without treating comments as calls', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'poppler-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text); };
  put('e2e/uses.spec.ts', "import './support/index'; import('./support/dynamic'); new URL('./fixture.sh', import.meta.url);");
  put('e2e/support/index.ts', "export * from './pdf.js';");
  put('e2e/support/pdf.ts', "execFileSync('/opt/homebrew/bin/pdftoppm', []);");
  put('e2e/support/dynamic.ts', "require('./cycle'); const POPPLER = '/opt/homebrew/bin';");
  put('e2e/support/cycle.ts', "export * from './dynamic';");
  put('e2e/fixture.sh', 'pdfimages -list input.pdf');
  put('e2e/comment.spec.ts', "// pdftotext documents the format only\nconst label = 'hello';");
  assert.deepEqual(scan(dir), ['e2e/uses.spec.ts']);
  put('e2e/another.spec.ts', "import './support/index';");
  assert.deepEqual(scan(dir), ['e2e/another.spec.ts', 'e2e/uses.spec.ts']);
  put('e2e/unlinked.sh', 'pdfunite a.pdf b.pdf out.pdf');
  assert.throws(() => scan(dir), /unlinked.sh/, 'an untraceable shell fixture cannot silently bypass the flags');
});

test('the Poppler flag set equals the specs and imported support collected by each named e2e group', async () => {
  const neededSpecs = scan(root);
  assert.deepEqual(neededSpecs, ['e2e/dashboard-export.spec.ts', 'e2e/design-export.spec.ts', 'e2e/design-live.spec.ts', 'e2e/design-scale.spec.ts', 'e2e/presentations-export.spec.ts']);
  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
  const env = Object.fromEntries([...workflow.matchAll(/^ {2}([A-Z_]+_E2E): (.*)\n((?: {4}\S.*\n)*)/gm)].map(([, name, value, folded]) => [name, value === '>-' ? folded.trim().replace(/\s+/g, ' ') : value.replace(/^''$/, '')]));
  const { name, scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const needing = [];
  const claimed = new Set();
  // Use the planner's script identity, and Playwright's --list for its actual config/env/selection, not a filename
  // convention. Named live/measured groups count too; default and packaged are never hosted and always keep the full
  // declaration. The planner refuses e2e:packaged: its separate packaged gate owns that script.
  for (const key of Object.keys(scripts).filter((key) => /^e2e:[a-z0-9-]+$/.test(key) && key !== 'e2e:packaged')) {
    const group = key.slice(4);
    const live = (env.LIVE_E2E ?? '').split(/\s+/).includes(group);
    const { outputs } = planOf({ ...env, HEAD_MESSAGE: `Gates: e2e:${group}\nRunner: macos\nLane: hosted${live ? '\nLive: yes' : ''}` }, scripts);
    const entry = JSON.parse(outputs.e2e).find((item) => item.group === group);
    const selection = readScript(scripts[entry.script], name);
    if (!selection) {
      // The non-hosted repeat/packaged and non-Playwright scripts cannot use this collector. A new Poppler reference
      // in their explicit specs fails here rather than being omitted from the flag list.
      assert.ok(!entry.hosted, `cannot collect hosted ${group}`);
      for (const spec of neededSpecs) assert.ok(!scripts[entry.script].includes(spec), `cannot collect Poppler user ${group}: ${spec}`);
      continue;
    }
    if (selection.elsewhere) continue;
    const collected = await listSelection(root, selection);
    const used = neededSpecs.filter((spec) => collected.has(spec));
    if (used.length) needing.push(group);
    for (const spec of used) claimed.add(spec);
    assert.equal(entry.poppler, used.length > 0, `${group}: ${used.join(', ') || 'no Poppler dependency'}`);
  }
  assert.deepEqual([...claimed].sort(), neededSpecs, 'every tool-using spec belongs to a named group');
  assert.deepEqual(needing.sort(), ['dashboard', 'design', 'design-live', 'design-scale', 'presentations']);
  assert.deepEqual((env.POPPLER_E2E ?? '').split(/\s+/).filter(Boolean).sort(), needing);
});
