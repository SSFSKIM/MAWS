import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
