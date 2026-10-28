// Static runtime edges only, adapted from .github/scripts/poppler-dependencies.test.mjs. This sees what specs
// import, NOT what an Electron group's build puts in out/: choosing groups for that boundary remains the lander's rule.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const sourceFile = /\.(?:[cm]?[jt]sx?|json)$/;
export function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.name === 'node_modules' || entry.name === '.git' ? [] : entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

// pnpm's packages list is a YAML block of quoted or bare globs in this tree. Reuse TypeScript's glob walker, not
// an installation's node_modules links: those do not exist in the committed snapshot.
function workspacePackages(root, ts) {
  const config = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(config)) return new Map();
  const block = /^packages:[ \t]*\n((?:[ \t]+[^\n]*\n|\n)*)/m.exec(readFileSync(config, 'utf8') + '\n')?.[1];
  if (!block) throw new Error('cannot read pnpm-workspace.yaml packages list');
  const patterns = [...block.matchAll(/^\s+-\s+(?:'([^']+)'|"([^"]+)"|([^#\s]+))[ \t]*(?:#.*)?$/gm)].map((match) => match[1] ?? match[2] ?? match[3]);
  const includes = patterns.filter((pattern) => !pattern.startsWith('!')).map((pattern) => `${pattern}/package.json`);
  const excludes = ['**/node_modules/**', '**/.git/**', ...patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1))];
  const files = [join(root, 'package.json'), ...ts.sys.readDirectory(root, ['.json'], excludes, includes)];
  return new Map(files.map((file) => { const pkg = JSON.parse(readFileSync(file, 'utf8')); return [pkg.name, { ...pkg, dir: dirname(file) }]; }));
}

function exportTarget(pkg, subpath, mode) {
  const runtime = (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(runtime).find((target) => target !== undefined);
    if (value && typeof value === 'object') {
      for (const [condition, target] of Object.entries(value)) {
        if (['node', mode, 'default'].includes(condition)) { const found = runtime(target); if (found !== undefined) return found; }
      }
    }
  };
  if (pkg.exports === undefined) return subpath === '.' ? pkg.main ?? './index' : subpath;
  const exports = pkg.exports;
  if (typeof exports !== 'object' || exports === null || Array.isArray(exports) || !Object.keys(exports).some((key) => key.startsWith('.'))) return subpath === '.' ? runtime(exports) : undefined;
  if (Object.hasOwn(exports, subpath)) return runtime(exports[subpath]);
  const patterns = Object.keys(exports).filter((key) => key.includes('*')).sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  for (const key of patterns) {
    const [prefix, suffix] = key.split('*');
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= prefix.length + suffix.length) return runtime(exports[key])?.replaceAll('*', subpath.slice(prefix.length, subpath.length - suffix.length));
  }
}

export function importGraph(root, ts) {
  root = resolve(root);
  const edges = new Map();
  const options = new Map();
  const workspaces = workspacePackages(root, ts);
  const inside = (file) => { const path = relative(root, file); return !path.startsWith('../') && !isAbsolute(path) && !path.split('/').includes('node_modules'); };
  // Read the nearest project's path aliases, including extends and the root's split tsconfig references. No directory
  // scan or type checking: only compiler options are needed, and bare third-party modules are never traversed.
  function compilerOptions(dir) {
    if (options.has(dir)) return options.get(dir);
    const inherited = dir === root ? {} : compilerOptions(dirname(dir));
    const result = { ...inherited, paths: { ...inherited.paths } };
    const configs = readdirSync(dir).filter((name) => /^tsconfig(?:\.[\w-]+)?\.json$/.test(name)).sort();
    for (const name of configs) {
      const parsed = ts.getParsedCommandLineOfConfigFile(join(dir, name), {}, { ...ts.sys, readDirectory: () => [], onUnRecoverableConfigFileDiagnostic: () => {} });
      const config = parsed?.options;
      if (!config?.paths) continue;
      for (const [key, targets] of Object.entries(config.paths)) result.paths[key] = targets.map((target) => resolve(config.baseUrl ?? config.pathsBasePath ?? dir, target));
    }
    result.moduleResolution = ts.ModuleResolutionKind.Bundler;
    options.set(dir, result);
    return result;
  }
  function moduleFile(specifier, file, mode = 'import') {
    const direct = specifier.startsWith('.') || isAbsolute(specifier) ? resolve(dirname(file), specifier) : null;
    if (direct && inside(direct) && existsSync(direct) && statSync(direct).isFile()) return direct;
    const found = ts.resolveModuleName(specifier, file, compilerOptions(dirname(file)), ts.sys).resolvedModule?.resolvedFileName;
    if (found && inside(found)) return found;
    if (!direct) {
      const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
      const pkg = workspaces.get(name);
      if (pkg) {
        const target = exportTarget(pkg, specifier === name ? '.' : `.${specifier.slice(name.length)}`, mode);
        if (target) {
          const absolute = resolve(pkg.dir, target);
          if (absolute.startsWith(pkg.dir + '/') && inside(absolute)) return moduleFile(absolute, file, mode);
        }
      }
    }
    return null;
  }
  function visit(file) {
    if (edges.has(file)) return;
    const next = new Set();
    edges.set(file, next);
    if (!sourceFile.test(file) || !existsSync(file)) return;
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const add = (text, mode) => { const found = moduleFile(text, file, mode); if (found && !/\.d\.[cm]?ts$/.test(found)) next.add(found); };
    const literal = (node) => node && ts.isStringLiteralLike(node) ? node.text : undefined;
    // Literal-path loaders: runnerImport(resolve(import.meta.dirname, '...')), require(resolve(__dirname, '...')),
    // and import(new URL('...', import.meta.url)). Do not mistake arbitrary strings or readFile data for imports.
    function loadedPath(node) {
      if (!node) return;
      if (literal(node) !== undefined) return literal(node);
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'href') return loadedPath(node.expression);
      if (ts.isCallExpression(node) && /^(?:\w+\.)?fileURLToPath$/.test(node.expression.getText(tree))) return loadedPath(node.arguments[0]);
      if (ts.isCallExpression(node) && /^(?:\w+\.)?(?:resolve|join)$/.test(node.expression.getText(tree))) {
        const [base, ...parts] = node.arguments;
        if (base && ['import.meta.dirname', '__dirname'].includes(base.getText(tree)) && parts.every((part) => literal(part) !== undefined)) return resolve(dirname(file), ...parts.map(literal));
      }
      if (ts.isNewExpression(node) && node.expression.getText(tree) === 'URL' && node.arguments?.[1]?.getText(tree) === 'import.meta.url') return literal(node.arguments[0]);
    }
    function imports(node) {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((item) => item.isTypeOnly))) return;
        add(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        if (node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every((item) => item.isTypeOnly))) return;
        add(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && /^(?:import|(?:\w+\.)?(?:require|runnerImport))$/.test(node.expression.getText(tree))) {
        const path = loadedPath(node.arguments[0]);
        if (path !== undefined) add(path, /(?:^|\.)require$/.test(node.expression.getText(tree)) ? 'require' : 'import');
      }
      ts.forEachChild(node, imports);
    }
    imports(tree);
    for (const target of next) visit(target);
  }
  return {
    reachable(specs) {
      const seen = new Set();
      function mark(file) {
        if (seen.has(file)) return;
        seen.add(file); visit(file);
        for (const target of edges.get(file)) mark(target);
      }
      for (const spec of specs) mark(resolve(root, spec));
      return new Set([...seen].map((file) => relative(root, file)));
    },
  };
}
