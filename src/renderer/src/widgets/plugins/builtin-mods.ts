// MAWS's built-in mods in the plugin library (X20; P2-B execution document §5.12; the interface ledger §1 `mods.list` and
// §6's dated line of 2026-10-09): the one function the second lander of P2-B and P2-C fills or re-points. P2-C owns the
// rows (`mods.list`) and their writes (`settings.set` on `mods.toHuman.enabled` for the app switch,
// `mods.setSessionOverride` for this session); until P2-C is on master this answers no rows, so the section is not drawn.
import type { AppSessionId } from '@shared/graph/ids';

export interface BuiltInModRow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: 'maws-contract' | 'external-compatible-style' | 'off';
  perSession: 'inherit' | 'on' | 'off' | null;
}

const NONE: { rows: BuiltInModRow[]; setEnabled: null } = { rows: [], setEnabled: null };

export function useBuiltInMods(appSessionId: AppSessionId): { rows: BuiltInModRow[]; setEnabled: ((id: string, enabled: boolean) => Promise<void>) | null } {
  void appSessionId; // `mods.list {appSessionId}` once P2-C lands
  return NONE;
}
