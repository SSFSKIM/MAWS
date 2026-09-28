// Read-only guard for the filesystem state service (C4 execution document, Acceptance item 9 and the residue
// *Acceptance against the real store*; charter §4.3, D-12): no source under `src/engine-host/fs/` (tests excluded) may
// reach a Node API that writes, whether imported by name, through a namespace, default or `promises` import, or as an
// `open` whose flags are not a read. It is the static leg of the read-only proof; the locked-clone negative control
// and the changed-path attribution are the runtime legs.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const FILESYSTEM_SERVICE_DIR = join(__dirname, '../../src/engine-host/fs');

const WRITE_API_BASES = [
  'writeFile', 'appendFile', 'rename', 'unlink', 'rm', 'rmdir', 'mkdir', 'mkdtemp', 'truncate', 'ftruncate', 'copyFile', 'cp',
  'symlink', 'link', 'chmod', 'fchmod', 'lchmod', 'chown', 'fchown', 'lchown', 'utimes', 'futimes', 'lutimes', 'write', 'writev',
];
export const WRITE_APIS: ReadonlySet<string> = new Set([...WRITE_API_BASES, ...WRITE_API_BASES.map((api) => `${api}Sync`), 'createWriteStream']);
const OPENERS: ReadonlySet<string> = new Set(['open', 'openSync']);
const READ_FLAGS: ReadonlySet<string> = new Set(['r', 'rs']);
const FS_MODULE = `(?:node:)?fs(?:/promises)?`;

export interface WriteApiViolation {
  file: string;
  line: number;
  api: string;
}

export function findWriteApis(source: string, file = '<inline>'): WriteApiViolation[] {
  const code = stripComments(source);
  const violations: WriteApiViolation[] = [];
  const flag = (index: number, api: string) => violations.push({ file, line: code.slice(0, index).split('\n').length, api });
  const namespaces = new Set<string>();
  const openers = new Set<string>();

  for (const match of code.matchAll(new RegExp(`import\\s+(type\\s+)?([^'"]*?)\\s+from\\s+['"]${FS_MODULE}['"]`, 'g'))) {
    if (match[1]) continue; // types only
    const clause = match[2];
    const namespace = /\*\s*as\s+([\w$]+)/.exec(clause)?.[1];
    if (namespace) namespaces.add(namespace);
    const defaultImport = /^\s*([\w$]+)\s*(?:,|$)/.exec(clause)?.[1];
    if (defaultImport) namespaces.add(defaultImport);
    for (const specifier of /\{([^}]*)\}/.exec(clause)?.[1].split(',') ?? []) {
      const named = /^\s*(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(specifier);
      if (!named || named[1]) continue;
      const [, , imported, local = imported] = named;
      if (WRITE_APIS.has(imported)) flag(match.index, imported);
      else if (imported === 'promises') namespaces.add(local);
      else if (OPENERS.has(imported)) openers.add(local);
    }
  }

  for (const ns of namespaces) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${escape(ns)}\\.(?:promises\\.)?([\\w$]+)`, 'g'))) {
      const api = match[1];
      if (WRITE_APIS.has(api)) flag(match.index, api);
      else if (OPENERS.has(api)) checkOpen(code, match.index + match[0].length, match.index, flag);
    }
  }
  for (const opener of openers) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${escape(opener)}\\s*\\(`, 'g'))) {
      checkOpen(code, match.index + match[0].length - 1, match.index, flag);
    }
  }

  for (const match of code.matchAll(new RegExp(`(?<![\\w$.])require\\(\\s*['"]${FS_MODULE}['"]\\s*\\)`, 'g'))) flag(match.index, 'require(fs)');
  for (const match of code.matchAll(new RegExp(`(?<![\\w$.])import\\(\\s*['"]${FS_MODULE}['"]`, 'g'))) flag(match.index, 'import(fs)');
  return violations.sort((a, b) => a.line - b.line);
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

const escape = (text: string) => text.replace(/[$]/g, '\\$');

export function scanFilesystemService(root = FILESYSTEM_SERVICE_DIR): { files: string[]; violations: WriteApiViolation[] } {
  const files = listSources(root).map((path) => relative(root, path).split(sep).join('/'));
  const violations = files.flatMap((file) => findWriteApis(readFileSync(join(root, file), 'utf8'), file));
  return { files, violations };
}

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(path);
    return /\.ts$/.test(entry.name) && !/\.test(-d)?\.ts$/.test(entry.name) ? [path] : [];
  });
}
