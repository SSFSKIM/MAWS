// Read-only guard for the filesystem state service (C4 execution document, Acceptance item 9 and the residue
// *Acceptance against the real store*; charter §4.3, D-12): no source under `src/engine-host/fs/` (tests excluded) may
// reach a Node API that writes, whether imported by name, through a namespace, default or `promises` import, taken out
// of one by destructuring, or as an `open` whose flags are not a read; nor may it spawn a process (`node:child_process`,
// which could run any writer), except the one allowlisted `/bin/ps` of the holder registry. It is the static leg of the
// read-only proof; the locked-clone negative control and the changed-path attribution are the runtime legs.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const FILESYSTEM_SERVICE_DIR = join(__dirname, '../../src/engine-host/fs');

const WRITE_API_BASES = [
  'writeFile', 'appendFile', 'rename', 'unlink', 'rm', 'rmdir', 'mkdir', 'mkdtemp', 'truncate', 'ftruncate', 'copyFile', 'cp',
  'symlink', 'link', 'chmod', 'fchmod', 'lchmod', 'chown', 'fchown', 'lchown', 'utimes', 'futimes', 'lutimes', 'write', 'writev',
];
export const WRITE_APIS: ReadonlySet<string> = new Set([...WRITE_API_BASES, ...WRITE_API_BASES.map((api) => `${api}Sync`), 'createWriteStream']);
export const SPAWN_APIS: ReadonlySet<string> = new Set(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']);
const OPENERS: ReadonlySet<string> = new Set(['open', 'openSync']);
const READ_FLAGS: ReadonlySet<string> = new Set(['r', 'rs']);
const FS_MODULE = `(?:node:)?fs(?:/promises)?`;
const CHILD_PROCESS_MODULE = `(?:node:)?child_process`;

// The one process the service runs: HolderRegistry's batched `ps -o pid=,lstart= -p …` (the pid-reuse guard), an
// `execFile` whose binary is its `ps` argument (`/bin/ps` unless a test injects another), once, in holders.ts.
const ALLOWED_SPAWNS: readonly { file: string; api: string; argument: string; count: number }[] = [{ file: 'holders.ts', api: 'execFile', argument: 'ps', count: 1 }];

export interface WriteApiViolation {
  file: string;
  line: number;
  api: string;
  argument?: string; // a spawn call's first argument, as written (what the allowlist matches)
}

export function findWriteApis(source: string, file = '<inline>'): WriteApiViolation[] {
  const code = stripComments(source);
  const body = blankImports(code); // references are looked for outside the import statements that bind them
  const violations: WriteApiViolation[] = [];
  const flag = (index: number, api: string, argument?: string) =>
    violations.push({ file, line: code.slice(0, index).split('\n').length, api, ...(argument === undefined ? {} : { argument }) });
  const fsNamespaces: string[] = [];
  const openers = new Set<string>();
  const cpNamespaces: string[] = [];
  const spawners = new Map<string, string>(); // local name → the spawn API it is

  for (const { index, namespaces, named } of imports(code, FS_MODULE)) {
    fsNamespaces.push(...namespaces);
    for (const [imported, local] of named) {
      if (WRITE_APIS.has(imported)) flag(index, imported);
      else if (imported === 'promises') fsNamespaces.push(local);
      else if (OPENERS.has(imported)) openers.add(local);
    }
  }
  for (const { namespaces, named } of imports(code, CHILD_PROCESS_MODULE)) {
    cpNamespaces.push(...namespaces);
    for (const [imported, local] of named) if (SPAWN_APIS.has(imported)) spawners.set(local, imported);
  }

  // Every fs namespace, including those destructuring yields (`const { promises: p } = fs`), scanned once each.
  const scanned = new Set<string>();
  for (let i = 0; i < fsNamespaces.length; i++) {
    const ns = fsNamespaces[i];
    if (scanned.has(ns)) continue;
    scanned.add(ns);
    for (const match of body.matchAll(new RegExp(`(?<![\\w$.])${escape(ns)}\\.(?:promises\\.)?([\\w$]+)`, 'g'))) {
      const api = match[1];
      if (WRITE_APIS.has(api)) flag(match.index, api);
      else if (OPENERS.has(api)) checkOpen(code, match.index + match[0].length, match.index, flag);
    }
    for (const match of body.matchAll(new RegExp(`(?<![\\w$.])${escape(ns)}(?:\\.promises)?\\s*\\[`, 'g'))) flag(match.index, 'fs[…]');
    for (const { index, members } of destructurings(body, ns)) {
      for (const [member, local] of members) {
        if (WRITE_APIS.has(member)) flag(index, member);
        else if (member === 'promises') fsNamespaces.push(local);
        else if (OPENERS.has(member)) openers.add(local);
      }
    }
  }
  for (const opener of openers) {
    for (const match of body.matchAll(new RegExp(`(?<![\\w$.])${escape(opener)}\\s*\\(`, 'g'))) {
      checkOpen(code, match.index + match[0].length - 1, match.index, flag);
    }
  }

  for (const ns of new Set(cpNamespaces)) {
    for (const match of body.matchAll(new RegExp(`(?<![\\w$.])${escape(ns)}\\.([\\w$]+)`, 'g'))) {
      if (SPAWN_APIS.has(match[1])) flag(match.index, match[1], firstArgument(code, match.index + match[0].length));
    }
    for (const match of body.matchAll(new RegExp(`(?<![\\w$.])${escape(ns)}\\s*\\[`, 'g'))) flag(match.index, 'child_process[…]');
    for (const { index, members } of destructurings(body, ns)) {
      for (const [member] of members) if (SPAWN_APIS.has(member)) flag(index, member);
    }
  }
  // Every reference to a spawn imported by name counts, called or not (`promisify(execFile)` reaches it too).
  for (const [local, api] of spawners) {
    for (const match of body.matchAll(new RegExp(`(?<![\\w$.])${escape(local)}(?![\\w$])`, 'g'))) {
      flag(match.index, api, firstArgument(code, match.index + match[0].length));
    }
  }

  for (const [module, label] of [[FS_MODULE, 'fs'], [CHILD_PROCESS_MODULE, 'child_process']] as const) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])require\\(\\s*['"]${module}['"]\\s*\\)`, 'g'))) flag(match.index, `require(${label})`);
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])import\\(\\s*['"]${module}['"]`, 'g'))) flag(match.index, `import(${label})`);
  }
  return violations.sort((a, b) => a.line - b.line);
}

interface ImportClause {
  index: number;
  namespaces: string[]; // namespace and default bindings
  named: [imported: string, local: string][];
}

// The value imports of a module (type-only imports and specifiers skipped).
function imports(code: string, module: string): ImportClause[] {
  const found: ImportClause[] = [];
  for (const match of code.matchAll(new RegExp(`import\\s+(type\\s+)?([^'"]*?)\\s+from\\s+['"]${module}['"]`, 'g'))) {
    if (match[1]) continue;
    const clause = match[2];
    const namespaces: string[] = [];
    const namespace = /\*\s*as\s+([\w$]+)/.exec(clause)?.[1];
    if (namespace) namespaces.push(namespace);
    const defaultImport = /^\s*([\w$]+)\s*(?:,|$)/.exec(clause)?.[1];
    if (defaultImport) namespaces.push(defaultImport);
    const named: ImportClause['named'] = [];
    for (const specifier of /\{([^}]*)\}/.exec(clause)?.[1].split(',') ?? []) {
      const parsed = /^\s*(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(specifier);
      if (!parsed || parsed[1]) continue;
      named.push([parsed[2], parsed[3] ?? parsed[2]]);
    }
    found.push({ index: match.index, namespaces, named });
  }
  return found;
}

// `const { a, b: c } = ns` and `… = ns.promises`: the members taken, as [member, local].
function destructurings(body: string, ns: string): { index: number; members: [member: string, local: string][] }[] {
  const found: { index: number; members: [string, string][] }[] = [];
  const pattern = new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${escape(ns)}(?:\\.promises)?(?![\\w$.\\[])`, 'g');
  for (const match of body.matchAll(pattern)) {
    const members: [string, string][] = [];
    for (const part of match[1].split(',')) {
      const parsed = /^\s*([\w$]+)\s*(?::\s*([\w$]+))?\s*(?:=[\s\S]*)?$/.exec(part);
      if (parsed) members.push([parsed[1], parsed[2] ?? parsed[1]]);
    }
    found.push({ index: match.index, members });
  }
  return found;
}

// `from` points at (or just before) the call's opening parenthesis; an open with no flags argument reads.
function checkOpen(code: string, from: number, at: number, flag: (index: number, api: string) => void): void {
  const open = code.indexOf('(', from);
  if (open === -1 || code.slice(from, open).trim() !== '') return; // a reference, not a call
  const flags = callArguments(code, open)[1];
  if (flags === undefined) return;
  const literal = /^(['"`])([^'"`]*)\1$/.exec(flags);
  if (literal && READ_FLAGS.has(literal[2])) return;
  flag(at, literal ? `open(…, '${literal[2]}')` : `open(…, ${flags})`);
}

// The first argument of the call whose callee ends at `from`, as written; undefined for a reference, not a call.
function firstArgument(code: string, from: number): string | undefined {
  const open = code.indexOf('(', from);
  if (open === -1 || code.slice(from, open).trim() !== '') return undefined;
  return callArguments(code, open)[0];
}

// The top-level, trimmed arguments of the call whose '(' is at `open`, honouring nesting and string literals.
function callArguments(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      i = closingQuote(code, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth -= 1;
    else if ((c === ',' || c === ')') && depth === 0) {
      const arg = code.slice(start, i).trim();
      if (arg.length > 0) args.push(arg);
      if (c === ')') break;
      start = i + 1;
    }
  }
  return args;
}

function closingQuote(code: string, start: number): number {
  for (let i = start + 1; i < code.length; i++) {
    if (code[i] === '\\') i += 1;
    else if (code[i] === code[start]) return i;
  }
  return code.length;
}

// Comments may name a write API freely; line structure is kept so reported lines match the source.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' ')).replace(/(^|[\s;])\/\/[^\n]*/gm, '$1');
}

// Import statements blanked (line structure kept), so a name is not counted where it is bound.
function blankImports(code: string): string {
  return code.replace(/import\s+[^'"]*?\s+from\s+['"][^'"]+['"]/g, (statement) => statement.replace(/[^\n]/g, ' '));
}

const escape = (text: string) => text.replace(/[$]/g, '\\$');

export function scanFilesystemService(root = FILESYSTEM_SERVICE_DIR): { files: string[]; violations: WriteApiViolation[] } {
  const files = listSources(root).map((path) => relative(root, path).split(sep).join('/'));
  const violations = files.flatMap((file) => allowlisted(findWriteApis(readFileSync(join(root, file), 'utf8'), file)));
  return { files, violations };
}

// Drops the allowlisted spawns, each up to its count; any further occurrence still counts.
function allowlisted(violations: WriteApiViolation[]): WriteApiViolation[] {
  const left = ALLOWED_SPAWNS.map((allowed) => ({ ...allowed }));
  return violations.filter((v) => {
    const allowed = left.find((a) => a.file === v.file && a.api === v.api && a.argument === v.argument && a.count > 0);
    if (allowed === undefined) return true;
    allowed.count -= 1;
    return false;
  });
}

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(path);
    return /\.ts$/.test(entry.name) && !/\.test(-d)?\.ts$/.test(entry.name) ? [path] : [];
  });
}
