// What main says about a directory's trust (C10 execution document, Interfaces "Shared shapes", trust.ts, and "Trust"):
// the trust key the engine records trust under, whether the engine's headless predicate `Xf()` would find it trusted,
// the global config file actually read, and what trust would load from the directory. Strict: an app shape. The
// reading itself is main's (src/main/sessions/trust.ts); this module holds only what the renderer also needs.
import * as z from 'zod';

export const TrustStateSchema = z.strictObject({
  directory: z.string(), // the realpath the session would run in
  trustKey: z.string(),
  keyKind: z.enum(['repo', 'directory']),
  configPath: z.string(), // the global config file actually read
  trusted: z.boolean(),
  source: z.literal('trustKey').nullable(), // the one entry read, mirroring the engine's `Xf()`; null when not trusted
  isHome: z.boolean(), // $HOME: the engine keeps trust for it per session only, so no bootstrap runs
  found: z.array(z.strictObject({ file: z.string(), summary: z.string() })), // what trust would load, read from the directory itself; empty when nothing gated exists
});
export type TrustState = z.infer<typeof TrustStateSchema>;

// The generic list, shown when `found` is empty (SPEC §3 15.5).
export const TRUST_GATES = [
  'Project permission rules (permissions.allow, additionalDirectories)',
  'Hooks',
  'Environment from settings',
  'MCP servers from .mcp.json',
  'Project plugins',
] as const;

// Paths as the engine compares them: NFC, no trailing separator (the root stays `/`).
export function normalizePath(path: string): string {
  const nfc = path.normalize('NFC');
  return nfc.length > 1 ? nfc.replace(/\/+$/, '') : nfc;
}

// Whether `directory` is the home directory. Both arguments are realpaths (main resolves them; the renderer only
// compares what main answered), so the comparison is on the normalised strings.
export function isHomeDirectory(directory: string, homeRealpath: string): boolean {
  return normalizePath(directory) === normalizePath(homeRealpath);
}
