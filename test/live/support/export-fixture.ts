// Exports a live run's journal as a pass-3 fixture (C3 M6): `npx tsx --tsconfig tsconfig.node.json
// test/live/support/export-fixture.ts <journal.jsonl> <fixture name>` writes
// spikes/protocol-probe/fixtures/pass3/<name>.jsonl with the provenance row first and the probe's redaction applied.
// Check the written file's spawn row by eye before committing it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportFixture } from './live';

const [journal, name] = process.argv.slice(2);
if (!journal || !name) throw new Error('usage: export-fixture.ts <journal.jsonl> <fixture name>');
const dest = join(__dirname, '../../../spikes/protocol-probe/fixtures/pass3', `${name}.jsonl`);
writeFileSync(dest, exportFixture(readFileSync(journal, 'utf8')));
console.log(dest);
