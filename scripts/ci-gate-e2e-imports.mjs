// Static runtime edges only, adapted from .github/scripts/poppler-dependencies.test.mjs. This sees what specs
// import, NOT what an Electron group's build puts in out/: choosing groups for that boundary remains the lander's rule.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const sourceFile = /\.(?:[cm]?[jt]sx?|json)$/;
export function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.name === 'node_modules' || entry.name === '.git' ? [] : entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

export function importGraph(root, ts) {
  root = resolve(root);
  const edges = new Map();
  const options = new Map();
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
  function moduleFile(specifier, file) {
    const direct = specifier.startsWith('.') || isAbsolute(specifier) ? resolve(dirname(file), specifier) : null;
    if (direct && inside(direct) && existsSync(direct) && statSync(direct).isFile()) return direct;
    const found = ts.resolveModuleName(specifier, file, compilerOptions(dirname(file)), ts.sys).resolvedModule?.resolvedFileName;
    return found && inside(found) ? found : null;
  }
  function visit(file) {
    if (edges.has(file)) return;
    const next = new Set();
    edges.set(file, next);
    if (!sourceFile.test(file) || !existsSync(file)) return;
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const add = (text) => { const found = moduleFile(text, file); if (found && !/\.d\.[cm]?ts$/.test(found)) next.add(found); };
    const literal = (node) => node && ts.isStringLiteralLike(node) ? node.text : undefined;
    // Literal-path loaders: runnerImport(resolve(import.meta.dirname, '...')), require(resolve(__dirname, '...')),
    // and import(new URL('...', import.meta.url)). Do not mistake arbitrary strings or readFile data for imports.
    function loadedPath(node) {
      if (!node) return;
      if (literal(node) !== undefined) return literal(node);
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
        if (path !== undefined) add(path);
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
