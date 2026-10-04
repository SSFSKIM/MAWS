import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ownerModSource } from './scenarios/pass3/owner-mod-source.mjs';

test('an exported owner source takes precedence over an unavailable plugin cache', () => {
  const root = mkdtempSync('/tmp/maws-owner-source-test-');
  try {
    mkdirSync(join(root, 'hooks/mods'), { recursive: true });
    mkdirSync(join(root, '.claude-plugin'));
    writeFileSync(join(root, 'hooks/mods/to-human.tsx'), 'export const registerToHuman = () => {};');
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ version: '7.135.0' }));
    writeFileSync(join(root, 'owner-commit'), 'dd970773\n');
    const source = ownerModSource({ env: { MAWS_OWNER_MOD_DIR: root }, cache: join(root, 'unavailable-cache') });
    assert.equal(source.ownerSource, join(root, 'hooks/mods/to-human.tsx'));
    assert.equal(source.ownerVersion, '7.135.0');
    assert.equal(source.ownerCommit, 'dd970773');
    assert.match(source.ownerSha256, /^[0-9a-f]{64}$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('without an override the latest numeric cache version still wins', () => {
  const cache = mkdtempSync('/tmp/maws-owner-cache-test-');
  try {
    for (const version of ['7.9.0', '7.133.0', '7.20.0']) {
      const root = join(cache, version);
      mkdirSync(join(root, 'hooks/mods'), { recursive: true });
      mkdirSync(join(root, '.claude-plugin'));
      writeFileSync(join(root, 'hooks/mods/to-human.tsx'), version);
      writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ version }));
    }
    const source = ownerModSource({ env: {}, cache });
    assert.equal(source.ownerVersion, '7.133.0');
    assert.equal(source.ownerCommit, undefined);
    assert.equal(source.root, join(cache, '7.133.0'));
  } finally { rmSync(cache, { recursive: true, force: true }); }
});


for (const { label, override, ownerFirst } of [
  { label: 'owner lookup followed by more scenarios', override: true, ownerFirst: true },
  { label: 'non-owner scenario before the first owner lookup', override: true, ownerFirst: false },
  { label: 'no override throughout the invocation', override: false, ownerFirst: false },
]) test(`invocation source selection survives the real scratch scrub: ${label}`, () => {
  const root = mkdtempSync('/tmp/maws-owner-invocation-test-');
  const exported = join(root, 'exported');
  const cache = join(root, 'cache');
  try {
    for (const [dir, version] of [[exported, '7.135.0'], [join(cache, '7.133.0'), '7.133.0']]) {
      mkdirSync(join(dir, 'hooks/mods'), { recursive: true });
      mkdirSync(join(dir, '.claude-plugin'));
      writeFileSync(join(dir, 'hooks/mods/to-human.tsx'), version);
      writeFileSync(join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ version }));
    }
    // No scenarios are invoked here. Runner initialization must preserve its input before even a non-owner scrub.
    const script = `
      import { execFileSync } from 'node:child_process';
      await import(${JSON.stringify(new URL('./run-pass3.mjs', import.meta.url).href)});
      const { clearEngineEnvironment } = await import(${JSON.stringify(new URL('./scenarios/pass3/mods-environment.mjs', import.meta.url).href)});
      const cache = ${JSON.stringify(cache)};
      const sources = [];
      if (${ownerFirst}) {
        const { ownerModSource } = await import(${JSON.stringify(new URL('./scenarios/pass3/owner-mod-source.mjs', import.meta.url).href)});
        sources.push(ownerModSource({ cache }));
      }
      clearEngineEnvironment();
      const inherited = JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.env))'], { encoding: 'utf8' }));
      const { ownerModSource } = await import(${JSON.stringify(new URL('./scenarios/pass3/owner-mod-source.mjs', import.meta.url).href)});
      sources.push(ownerModSource({ cache }));
      clearEngineEnvironment();
      sources.push(ownerModSource({ cache }));
      console.log(JSON.stringify({ sources, inherited }));
    `;
    const { sources, inherited } = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, LANG: 'C', LC_MAWS_TEST: 'C', MAWS_SCRUB_SENTINEL: 'must-not-reach-child', ...(override ? { MAWS_OWNER_MOD_DIR: exported } : {}) },
    }));
    assert.equal(inherited.MAWS_OWNER_MOD_DIR, undefined);
    assert.equal(inherited.MAWS_SCRUB_SENTINEL, undefined);
    assert.equal(inherited.HOME, root);
    assert.equal(inherited.PATH, process.env.PATH);
    assert.equal(inherited.LC_MAWS_TEST, 'C');
    for (const source of sources) {
      assert.equal(source.root, override ? exported : join(cache, '7.133.0'));
      assert.equal(source.ownerVersion, override ? '7.135.0' : '7.133.0');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
