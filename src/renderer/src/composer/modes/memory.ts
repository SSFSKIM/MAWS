// `#` (C7 execution document, "`!` and `#`", as amended 2026-09-29): a leading `#` is the memory mode; Enter appends the
// note through C3's `session.memoryAppend` to the target the session remembers (the project memory file by default).
// The target menu lists the memory dialog's files: the project and user files, and every other listed file by path, a
// file that does not exist yet offered as a new file (the host creates a missing folder inside a listed memory folder).
// A refusal that still arrives keeps the text and shows the host's message.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { MemoryTarget } from '../../stores/composer';

export interface MemoryFile {
  kind: string;
  path: string;
  label: string;
  exists: boolean;
}

export interface MemoryTargetOption {
  target: MemoryTarget;
  label: string;
  detail: string;
}

const targetOf = (file: MemoryFile): MemoryTarget => (file.kind === 'project' || file.kind === 'user' ? { kind: file.kind, path: null } : { kind: 'path', path: file.path });

export function memoryTargetOptions(files: readonly MemoryFile[]): MemoryTargetOption[] {
  return files.map((file) => ({ target: targetOf(file), label: file.label, detail: file.exists ? file.path : 'new file' }));
}

export const sameTarget = (a: MemoryTarget, b: MemoryTarget): boolean => a.kind === b.kind && a.path === b.path;

// The chip's words for a target: the listed file's label, else the path, else the project or user memory by name.
export function memoryTargetLabel(target: MemoryTarget, files: readonly MemoryFile[]): string {
  const listed = files.find((file) => sameTarget(targetOf(file), target));
  if (listed) return listed.label;
  if (target.kind === 'path') return target.path ?? 'Memory file';
  return target.kind === 'project' ? 'Project memory' : 'User memory';
}

export async function appendMemory(client: MawsBridge, appSessionId: AppSessionId, text: string, target: MemoryTarget): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const result = await client.invoke('session.memoryAppend', { appSessionId, text, target });
  return result.ok ? { ok: true, path: result.value.path } : { ok: false, error: result.error.message };
}
