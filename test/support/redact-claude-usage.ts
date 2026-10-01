// Writes test/fixtures/claude-usage/: a redacted copy of ClaudeUsage's own files, the input of the usage reader's suite
// and of the status line's end-to-end run (C7 execution document, M1 "Decisions local to M1"). Run once and commit the
// output: node test/support/redact-claude-usage.ts [source directory]
// The source (default ~/Library/Application Support/ClaudeUsage) is only read. Redaction: emails become <n>@example.test,
// display names Account <n>, organisation ids a fixed fake per account (n in accounts.json order); each history file
// keeps its newest 40 rows; pins keep 12 entries, the most recently used one of every account first, then the most
// recently used others. Account ids, window readings, the drain target and gateway.json are kept as they are.
// W6: `gateway-requests.jsonl`, `codex-accounts.json` and `codex-pins.*.json` in the fixture are synthetic, written by
// hand in ClaudeUsage's shapes (the last ten minutes before the fixture's clock, two Codex accounts); this script
// neither reads nor rewrites them.
const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');

const HISTORY_ROWS = 40;
const PIN_COUNT = 12;

const source = process.argv[2] ?? path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeUsage');
const target = path.join(import.meta.dirname, '..', 'fixtures', 'claude-usage');

type Account = Record<string, unknown> & { uuid: string };
type Pin = { accountUUID: string; lastUsed: number };

const read = (name: string) => fs.readFileSync(path.join(source, name), 'utf8');
const accounts = JSON.parse(read('accounts.json')) as Account[];
const redacted = accounts.map((account, i) => ({
  ...account,
  email: `${i + 1}@example.test`,
  displayName: `Account ${i + 1}`,
  ...('organizationUUID' in account && { organizationUUID: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }),
}));

const pinsFile = JSON.parse(read('pins.json')) as { drainTarget: unknown; drainTargetIsManual?: unknown; pins: Record<string, Pin> };
const byRecency = Object.entries(pinsFile.pins).sort(([, a], [, b]) => b.lastUsed - a.lastUsed);
const kept = new Map<string, Pin>();
for (const account of accounts) {
  const newest = byRecency.find(([, pin]) => pin.accountUUID === account.uuid);
  if (newest) kept.set(newest[0], newest[1]);
}
for (const [id, pin] of byRecency) {
  if (kept.size >= PIN_COUNT) break;
  kept.set(id, pin);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'history'), { recursive: true });
const write = (name: string, text: string) => fs.writeFileSync(path.join(target, name), text);
write('accounts.json', `${JSON.stringify(redacted, null, 2)}\n`);
write('pins.json', `${JSON.stringify({ drainTarget: pinsFile.drainTarget, drainTargetIsManual: pinsFile.drainTargetIsManual, pins: Object.fromEntries(kept) }, null, 2)}\n`);
if (fs.existsSync(path.join(source, 'gateway.json'))) write('gateway.json', read('gateway.json'));
for (const account of accounts) {
  const file = path.join('history', `${account.uuid}.jsonl`);
  if (!fs.existsSync(path.join(source, file))) continue;
  const rows = read(file).split('\n').filter((line) => line.trim() !== '');
  write(file, `${rows.slice(-HISTORY_ROWS).join('\n')}\n`);
}
console.log(`wrote ${target}: ${accounts.length} accounts, ${kept.size} pins`);
