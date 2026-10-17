// What the owner approves in P3-H's Send to live run (e2e/send-to-live.spec.ts): a tool call the request needs, bound
// to the one file the Send exported. The connector's upload of that file (`local_path`) or a Read of it (`file_path`),
// each named by an absolute path whose canonical form is the export's own, which itself lies under the scratch
// profile's artifact store; anything else (another tool, another file, a symlink to it from elsewhere resolving
// differently, a relative path) is denied. Free of Playwright, so test/support/send-to-approval.test.ts runs it.
import { realpathSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';

const real = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

export interface ApprovalRequest {
  toolName: string;
  input: unknown;
}

export function approvesExport(request: ApprovalRequest, { tool, exported, store }: { tool: string; exported: string; store: string }): boolean {
  const field = request.toolName === tool ? 'local_path' : request.toolName === 'Read' ? 'file_path' : null;
  if (field === null || typeof request.input !== 'object' || request.input === null) return false;
  const path = (request.input as Record<string, unknown>)[field];
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  const target = real(path);
  const file = real(exported);
  const root = real(store);
  return target !== null && file !== null && root !== null && file.startsWith(`${root}${sep}`) && target === file;
}

// The card that shows one request: the engine host names a request's attention item `<appSessionId>:<requestId>`
// (src/engine-host/broker.ts), and the request card carries it as `data-request-card`.
export const requestCardSelector = (appSessionId: string, requestId: string): string => `[data-request-card="${appSessionId}:${requestId}"]`;
