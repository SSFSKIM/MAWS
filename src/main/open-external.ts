// carried by C9 until the rebase over C5 (wave-2 ledger d.11)
// The one scheme-checked `shell.openExternal` (C5 lands the real one behind `layout.openExternal`; C9's `pty.openLink`
// shares it). Only `http:`, `https:` and `mailto:` reach the OS; anything else is logged and refused.
import { shell } from 'electron';

const OPENABLE = new Set(['http:', 'https:', 'mailto:']);

export function openExternalUrl(url: string): boolean {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = '';
  }
  if (!OPENABLE.has(protocol)) {
    console.warn(`[open-external] refused to open ${JSON.stringify(url)}: only http, https and mailto links open`);
    return false;
  }
  shell.openExternal(url).catch((error: unknown) => console.error(`[open-external] could not open ${url}`, error));
  return true;
}
// carried by C9 until the rebase over C5 (wave-2 ledger d.11)
