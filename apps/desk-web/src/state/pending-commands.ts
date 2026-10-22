// Browser ownership, not a second outcome log: only our unobserved command nonces and display metadata survive a
// killed home-screen app. Outcomes come from the hub's replay. No signed RPC, arguments or transcript text is stored.
export type PendingCommand = { project: string; machine: string; session: string; nonce: string; name: string; outlives?: string; at: number };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'desk.pending-commands';
const RETENTION_MS = 24 * 60 * 60 * 1000; // The hub's command-receipt retention.
const PER_PROJECT = 256;

function valid(value: unknown): value is PendingCommand {
  if (!value || typeof value !== 'object') return false;
  const row = value as PendingCommand;
  return ['project', 'machine', 'session', 'nonce', 'name'].every((key) => typeof row[key as keyof PendingCommand] === 'string')
    && typeof row.at === 'number' && Number.isFinite(row.at) && (row.outlives === undefined || typeof row.outlives === 'string');
}

export class PendingCommands {
  private entries: PendingCommand[] = [];
  private memoryOnly = false;
  constructor(private readonly storage?: StorageLike) { this.read(); }

  remember(command: Omit<PendingCommand, 'at'>): void {
    this.read();
    this.entries = this.entries.filter((r) => r.project !== command.project || r.nonce !== command.nonce);
    this.entries.push({ ...command, at: Date.now() });
    this.prune();
    this.save();
  }

  seen(project: string, nonce: string): void {
    this.read();
    this.entries = this.entries.filter((r) => r.project !== project || r.nonce !== nonce);
    this.save();
  }

  pending(project: string, machine?: string, session?: string): PendingCommand[] {
    this.read();
    this.prune();
    return this.entries.filter((r) => r.project === project && (machine === undefined || r.machine === machine) && (session === undefined || r.session === session));
  }

  private read(): void {
    if (!this.storage || this.memoryOnly) return;
    try {
      const value: unknown = JSON.parse(this.storage.getItem(KEY) ?? '[]');
      if (Array.isArray(value)) this.entries = value.filter(valid);
    } catch { /* A denied/corrupt store does not lose this page's in-memory ownership. */ }
    this.prune();
  }

  private prune(): void {
    const counts = new Map<string, number>();
    this.entries = this.entries.filter((r) => Date.now() - r.at < RETENTION_MS).reverse().filter((r) => {
      const count = (counts.get(r.project) ?? 0) + 1;
      counts.set(r.project, count);
      return count <= PER_PROJECT;
    }).reverse();
  }

  private save(): void {
    try { this.storage?.setItem(KEY, JSON.stringify(this.entries)); } catch { this.memoryOnly = true; }
  }
}
function storage(): StorageLike | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export const pendingCommands = new PendingCommands(storage());
