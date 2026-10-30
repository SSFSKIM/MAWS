// Spec-file selection without Playwright, builds or node_modules. Literal package-script selections and the
// selection fields of Playwright configs are read, never executed. Unreadable groups are explicitly skipped.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { readScript } from '../.github/scripts/e2e-default-specs.mjs';
import { filesUnder } from './ci-gate-e2e-imports.mjs';

const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const spec = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const fields = new Set(['testDir', 'testMatch', 'testIgnore']);

function configSelection(file, env, ts) {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const unknown = () => { throw new Error(`nonliteral selection in ${file}`); };
  function value(node) {
    if (!node) return unknown();
    if (ts.isParenthesizedExpression(node)) return value(node.expression);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isRegularExpressionLiteral(node)) { const text = node.text; const end = text.lastIndexOf('/'); return new RegExp(text.slice(1, end), text.slice(end + 1)); }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value);
    if (ts.isObjectLiteralExpression(node)) {
      const selected = {};
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) Object.assign(selected, value(property.expression));
        else if (fields.has(property.name?.getText(tree).replace(/^['"]|['"]$/g, ''))) selected[property.name.getText(tree).replace(/^['"]|['"]$/g, '')] = value(property.initializer);
      }
      return selected;
    }
    if (ts.isConditionalExpression(node)) return value(value(node.condition) ? node.whenTrue : node.whenFalse);
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(tree) === 'process.env') return env[node.name.text];
    if (ts.isBinaryExpression(node)) {
      const left = value(node.left);
      if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) return left || value(node.right);
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return left && value(node.right);
      if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) return left === value(node.right);
      if (node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) return left !== value(node.right);
    }
    return unknown();
  }
  const exported = tree.statements.find((node) => ts.isExportAssignment(node));
  let node = exported?.expression;
  if (node && ts.isCallExpression(node) && node.expression.getText(tree) === 'defineConfig') node = node.arguments[0];
  return value(node);
}

function matches(file, patterns) {
  return (Array.isArray(patterns) ? patterns : [patterns]).some((pattern) => {
    if (pattern instanceof RegExp) { pattern.lastIndex = 0; return pattern.test(file); }
    if (typeof pattern !== 'string' || /[{}[\]]/.test(pattern)) throw new Error('unsupported testMatch/testIgnore glob');
    // Playwright treats a bare filename as **/filename. The tree's configs use this small glob subset or regexps.
    const glob = pattern.includes('/') ? pattern : `**/${pattern}`;
    let regex = '';
    for (let i = 0; i < glob.length; i++) {
      if (glob.slice(i, i + 3) === '**/') { regex += '(?:.*/)?'; i += 2; }
      else if (glob.slice(i, i + 2) === '**') { regex += '.*'; i++; }
      else if (glob[i] === '*') regex += '[^/]*';
      else if (glob[i] === '?') regex += '[^/]';
      else regex += glob[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${regex}$`).test(file);
  });
}

export function discoverGroups(root, ts) {
  const { scripts, name } = json(join(root, 'package.json'));
  const groups = new Map();
  const notes = [];
  function select(script, dir = root) {
    const workspace = /^pnpm --filter ([\w@/-]+) ([\w:-]+)$/.exec(script);
    if (workspace) {
      const apps = join(root, 'apps');
      for (const entry of existsSync(apps) ? readdirSync(apps) : []) {
        const pkgFile = join(apps, entry, 'package.json');
        if (!existsSync(pkgFile)) continue;
        const pkg = json(pkgFile);
        if (pkg.name !== workspace[1]) continue;
        const child = pkg.scripts?.[workspace[2]];
        if (!child) throw new Error('workspace script missing');
        return select(child.replace(/^(?:vite|pnpm) build && /, ''), dirname(pkgFile));
      }
      throw new Error('workspace not found');
    }
    const selection = readScript(script, name);
    if (!selection || selection.elsewhere) throw new Error('unreadable package script');
    let config = 'playwright.config.ts';
    const literals = [];
    for (let i = 0; i < selection.args.length; i++) {
      if (selection.args[i] === '--config') config = selection.args[++i];
      else literals.push(selection.args[i]);
    }
    if (literals.length > 0) {
      if (!literals.every((file) => spec.test(file) && existsSync(resolve(dir, file)))) throw new Error('nonliteral spec selection');
      return literals.map((file) => relative(root, resolve(dir, file))).sort();
    }
    const configFile = resolve(dir, config);
    const { testDir = '.', testMatch, testIgnore = [] } = configSelection(configFile, selection.env, ts);
    return filesUnder(resolve(dirname(configFile), testDir))
      .filter((file) => (testMatch === undefined ? spec.test(file) : matches(file, testMatch)) && !matches(file, testIgnore))
      .map((file) => relative(root, file)).sort();
  }
  for (const [group, script] of Object.entries(scripts)) {
    // These are the planner's group names; packaged is a separate gate, not e2e:packaged.
    if (!/^e2e:[a-z0-9-]+$/.test(group) || group === 'e2e:packaged' || group === 'e2e:default') continue;
    try { groups.set(group, select(script)); }
    catch (error) { notes.push(`skipped ${group}: ${error.message.replaceAll(root + '/', '')}`); }
  }
  try {
    // e2e-default-specs.mjs derives default by subtracting the groups beside it. Here all known named groups are
    // beside it, so these are its own specs, not duplicate warnings for every named group's files. Unreadable
    // groups may leave extra files in default; this is advisory, never used to select the run's actual tests.
    const claimed = new Set([...groups.values()].flat());
    groups.set('e2e:default', select(scripts.e2e).filter((file) => !claimed.has(file)));
  } catch (error) { notes.push(`skipped e2e:default: ${error.message.replaceAll(root + '/', '')}`); }
  return { groups, notes };
}
