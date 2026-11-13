// The rule of a file the transcript names (UX wave U6c, docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md,
// Interfaces §A). Stubs that name nothing: the suites are written first.
import { parseAnchoredText } from '../anchor/message';

// `.`, `..` and repeated separators collapsed without touching the disk (ruled 2026-09-29, O1): a receipt's path comes
// from the model's input and may carry `..`, which `files.*` refuses as not normal; the boundary then judges the
// normalised path as any other. A relative path stays relative (and is refused by the service as such).
export function normalizeLexically(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined || '.';
}

export function hrefOf(destination: string): string {
  return destination;
}
export function clickPath(_destination: string): string | null {
  return null;
}
export function linkPaths(_text: string): string[] {
  return [];
}
export const READ_TOOLS: ReadonlySet<string> = new Set();
export const EDIT_TOOLS: ReadonlySet<string> = new Set();
export function chipPath(_toolName: string, _input: unknown): string | null {
  return null;
}
export function isMcpTool(_toolName: string): boolean {
  return false;
}
export function anchorPath(text: string): string | null {
  return parseAnchoredText(text) && null;
}

export interface PendingCall {
  toolUseId: string;
  when: 'mcp' | 'edit';
}
export type RowClaim = { names: true } | { names: false; pending: PendingCall[] };
export function rowClaim(_row: unknown, _path: string): RowClaim {
  return { names: false, pending: [] };
}
export function callClass(_row: unknown, _toolUseId: string): 'mcp' | 'edit' | 'other' | null {
  return null;
}
export function needlesOf(_path: string): string[] {
  return [];
}
