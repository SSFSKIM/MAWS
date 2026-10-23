// WR 73: export identity is an explicit MAWS setting, otherwise the routed Claude account's display name.
// No filesystem/login identity is inferred; without either, the file uses a neutral label.
type AccountNames = { available: boolean; drainTarget: string | null; accounts: readonly { uuid: string; displayName: string }[] };

export function routedAccountName(snapshot: AccountNames | null): string | null {
  return snapshot?.available ? snapshot.accounts.find((account) => account.uuid === snapshot.drainTarget)?.displayName.trim() || null : null;
}

export function resolveExportHumanName(saved: string | null | undefined, account: string | null): string {
  return saved?.trim() || account?.trim() || 'Comment author';
}
