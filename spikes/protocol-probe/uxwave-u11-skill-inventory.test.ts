// UX wave U11a P3, MAWS's side: what Customize's inventory (src/engine-host/customization/inventory.ts, the rows
// CustomizeView lists by `name`) shows for the invented skills of the skill-names probe (scenarios/pass3/
// uxwave-u11-skill-names.mjs). Not a regression test: it runs only when P3_HOME names the scratch HOME that probe left
// and P3_CWD its scratch repository, on the machine that recorded it, and writes the probe's rows to P3_OUT.
//   P3_HOME=/tmp/p3u-…/home P3_CWD=/tmp/p3u-…/work P3_OUT=out.json node_modules/.bin/vitest run --config spikes/protocol-probe/uxwave-u11-skill-inventory.vitest.config.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCustomizationInventory } from '../../src/engine-host/customization/inventory';

const HOME = process.env.P3_HOME ?? '';
const CWD = process.env.P3_CWD ?? '';
const OUT = process.env.P3_OUT ?? '';

describe.runIf(HOME !== '' && CWD !== '' && OUT !== '')('U11a P3: the inventory of the probe skills', () => {
  it('reads the rows', async () => {
    const answer = await readCustomizationInventory(CWD, { userData: mkdtempSync(join(tmpdir(), 'p3u-userdata-')), captureEnv: async () => ({ HOME }) });
    const anon = (p: string) => p.split(CWD).join('<repo>').split(HOME).join('<home>');
    const rows = answer.skills.filter((s) => /p3u/.test(s.path)).map((s) => ({ name: s.name, source: s.source, plugin: s.plugin, path: anon(s.path) }));
    writeFileSync(OUT, JSON.stringify({ skills: rows, warnings: answer.warnings.map(anon) }, null, 1) + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });
});
