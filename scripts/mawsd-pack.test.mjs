// node --test scripts/mawsd-pack.test.mjs (from anywhere; no install needed; needs tar). scripts/mawsd-pack.mjs, `pnpm
// mawsd:pack` (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The pack"): its assembly against a fixture tree
// shaped as the checkout (out/main and a hoisted node_modules), the externals' production closure present and nothing
// else; and the Linux runtime, whose download is faked: refused on a wrong sha256 before it is unpacked, and on a right
// one unpacked and put through the smoke checks (the fixture's `node` is a shell script answering them).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { URL } from 'node:url';
import { closure, contentId, pack } from './mawsd-pack.mjs';

let dir;
let root;

const write = (path, text, mode) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, mode === undefined ? undefined : { mode });
};
const pkg = (path, manifest) => write(join(root, path, 'package.json'), JSON.stringify(manifest));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-pack-'));
  root = join(dir, 'checkout');
  pkg('.', { name: 'maws', version: '1.2.3', dependencies: { zod: '^4', '@modelcontextprotocol/sdk': '1', 'node-pty': '1', react: '19' }, devDependencies: { vitest: '4' } });
  write(join(root, 'out/main/mawsd.js'), 'require("zod");\n');
  write(join(root, 'out/main/index.js'), '// main\n');
  write(join(root, 'out/main/chunks/a.js'), '// a chunk\n');
  write(join(root, 'out/preload/index.js'), '// not mawsd’s\n');
  pkg('node_modules/zod', { name: 'zod', version: '4.6.5' });
  write(join(root, 'node_modules/zod/index.js'), 'module.exports = {};\n');
  // the SDK: a dependency hoisted, one nested under it (another version), an optional peer missing, a required peer present
  pkg('node_modules/@modelcontextprotocol/sdk', { name: '@modelcontextprotocol/sdk', dependencies: { ajv: '^8', 'content-type': '^1' }, peerDependencies: { zod: '^4', '@cfworker/json-schema': '^4' }, peerDependenciesMeta: { '@cfworker/json-schema': { optional: true } } });
  pkg('node_modules/ajv', { name: 'ajv', version: '8.0.0', dependencies: { 'fast-deep-equal': '^3' } });
  pkg('node_modules/ajv/node_modules/fast-deep-equal', { name: 'fast-deep-equal', version: '3.0.0' });
  pkg('node_modules/fast-deep-equal', { name: 'fast-deep-equal', version: '2.0.0' }); // another version, which ajv does not resolve
  pkg('node_modules/content-type', { name: 'content-type', optionalDependencies: { 'not-installed': '1' } });
  pkg('node_modules/node-pty', { name: 'node-pty', dependencies: { 'node-addon-api': '^7' } });
  write(join(root, 'node_modules/node-pty/build/Release/pty.node'), 'addon');
  pkg('node_modules/node-addon-api', { name: 'node-addon-api' });
  pkg('node_modules/react', { name: 'react' }); // the app's, not mawsd's
  pkg('node_modules/vitest', { name: 'vitest' });
  write(join(root, 'node_modules/.bin/vitest'), '#!/bin/sh\n');
  write(join(root, 'native/session-host/prebuilds/darwin-arm64/maws-session-host'), 'darwin host', 0o644);
  write(join(root, 'native/session-host/prebuilds/linux-x64/maws-session-host'), 'linux host', 0o644);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const quiet = { log: () => {} };
const listing = (at) => readdirSync(at, { recursive: true }).map(String).sort();
const packs = (out) => readdirSync(out).filter((name) => name !== '.downloads');

test('the closure is the externals and their production dependencies, resolved as Node resolves them', () => {
  assert.deepEqual(closure(root, ['zod', '@modelcontextprotocol/sdk', 'node-pty']), [
    'node_modules/@modelcontextprotocol/sdk',
    'node_modules/ajv',
    'node_modules/ajv/node_modules/fast-deep-equal',
    'node_modules/content-type',
    'node_modules/node-addon-api',
    'node_modules/node-pty',
    'node_modules/zod',
  ]);
});

test('a production dependency that is not installed refuses the closure', () => {
  rmSync(join(root, 'node_modules/node-addon-api'), { recursive: true });
  assert.throws(() => closure(root, ['node-pty']), /node-pty needs node-addon-api, which is not installed/);
});

test('the pack holds out/main, the closure and a package.json naming its release; on macOS no runtime', async () => {
  const at = await pack({ root, out: join(dir, 'dist'), platform: 'darwin', arch: 'arm64', commit: 'a1b2c3d4', build: false, ...quiet });
  assert.match(at, /\/dist\/1\.2\.3-a1b2c3d4-[0-9a-f]{8}$/);
  assert.equal(readFileSync(join(at, 'out/main/mawsd.js'), 'utf8'), 'require("zod");\n');
  assert.ok(existsSync(join(at, 'out/main/chunks/a.js')));
  assert.ok(!existsSync(join(at, 'out/preload')));
  assert.ok(existsSync(join(at, 'node_modules/node-pty/build/Release/pty.node')));
  assert.equal(JSON.parse(readFileSync(join(at, 'node_modules/ajv/node_modules/fast-deep-equal/package.json'), 'utf8')).version, '3.0.0');
  assert.equal(readFileSync(join(at, 'bin/maws-session-host'), 'utf8'), 'darwin host'); // P5 O16 M1
  assert.equal(statSync(join(at, 'bin/maws-session-host')).mode & 0o777, 0o755);
  for (const absent of ['node_modules/react', 'node_modules/vitest', 'node_modules/.bin', 'node_modules/fast-deep-equal', 'runtime']) assert.ok(!existsSync(join(at, absent)), absent);
  assert.deepEqual(JSON.parse(readFileSync(join(at, 'package.json'), 'utf8')), {
    name: 'maws-mawsd',
    version: '1.2.3',
    private: true,
    main: 'out/main/mawsd.js',
    mawsd: { release: basename(at), commit: 'a1b2c3d4', platform: 'darwin', arch: 'arm64', node: null },
  });
});

test('the release is named by its content: the same tree packs to the same name, a rebuild of one commit that changed anything to another', async () => {
  const options = { root, platform: 'darwin', arch: 'arm64', commit: 'a1b2c3d4', build: false, ...quiet };
  const first = basename(await pack({ ...options, out: join(dir, 'one') }));
  assert.equal(basename(await pack({ ...options, out: join(dir, 'two') })), first);
  write(join(root, 'out/main/chunks/a.js'), '// a chunk, rebuilt\n');
  const rebuilt = basename(await pack({ ...options, out: join(dir, 'three') }));
  assert.match(rebuilt, /^1\.2\.3-a1b2c3d4-[0-9a-f]{8}$/);
  assert.notEqual(rebuilt, first);
});

test('the content id covers each entry’s path, kind and bytes', () => {
  const tree = join(dir, 'tree');
  write(join(tree, 'a/b.js'), 'x');
  const before = contentId(tree);
  assert.match(before, /^[0-9a-f]{8}$/);
  assert.equal(contentId(tree), before);
  rmSync(join(tree, 'a'), { recursive: true });
  write(join(tree, 'a/c.js'), 'x');
  assert.notEqual(contentId(tree), before, 'a renamed file');
  rmSync(join(tree, 'a'), { recursive: true });
  write(join(tree, 'a/b.js'), 'x', 0o755);
  assert.notEqual(contentId(tree), before, 'a file made executable');
});

test('a new pack replaces the one before it in the output directory', async () => {
  const out = join(dir, 'dist');
  await pack({ root, out, platform: 'darwin', arch: 'arm64', commit: 'aaaaaaaa', build: false, ...quiet });
  await pack({ root, out, platform: 'darwin', arch: 'arm64', commit: 'bbbbbbbb', build: false, ...quiet });
  assert.equal(readdirSync(out).length, 1);
  assert.match(readdirSync(out)[0], /^1\.2\.3-bbbbbbbb-[0-9a-f]{8}$/);
});

// ---- the Linux runtime ------------------------------------------------------------------------------------------------

// A Node release archive (`node-v<version>-linux-<arch>/bin/node`) whose node is a script answering the smoke checks.
function fixtureArchive(version, node) {
  const top = `node-v${version}-linux-x64`;
  const src = join(dir, 'archive-src');
  write(join(src, top, 'bin/node'), node, 0o755);
  write(join(src, top, 'include/node/node.h'), '');
  write(join(src, top, 'lib/node_modules/npm/package.json'), '{}');
  write(join(src, top, 'LICENSE'), 'MIT');
  const archive = join(dir, `${top}.tar.gz`);
  const made = spawnSync('tar', ['-czf', archive, '-C', src, top]);
  assert.equal(made.status, 0, String(made.stderr));
  return archive;
}
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function manifest(version, sha) {
  const path = join(dir, 'node.json');
  writeFileSync(path, JSON.stringify({ version, sha256: { 'linux-x64': sha, 'linux-arm64': '0'.repeat(64) } }));
  return path;
}
const GOOD_NODE = `#!/bin/sh
case "$*" in
  *process.versions.node*) echo 24.21.0 ;;
  *.ts) echo 1 ;;
esac
exit 0
`;

test('the runtime is refused on a wrong sha256, before it is unpacked, and no pack is left', async () => {
  const archive = fixtureArchive('24.21.0', GOOD_NODE);
  const fetched = [];
  const download = async (url, to) => {
    fetched.push(url);
    cpSync(archive, to);
  };
  const out = join(dir, 'dist');
  await assert.rejects(
    pack({ root, out, platform: 'linux', arch: 'x64', commit: 'a1b2c3d4', build: false, manifest: manifest('24.21.0', 'f'.repeat(64)), download, ...quiet }),
    new RegExp(`node-v24.21.0-linux-x64.tar.gz has sha256 ${sha256(archive)}, not the pinned ${'f'.repeat(64)}`),
  );
  assert.deepEqual(fetched, ['https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz']);
  assert.deepEqual(packs(out), []);
  assert.ok(!existsSync(join(out, '.downloads', 'node-v24.21.0-linux-x64.tar.gz')), 'the refused archive is not kept');
});

test('a runtime matching its sha256 is unpacked as runtime/bin/node and passes the smoke checks; a cached archive is reused', async () => {
  const archive = fixtureArchive('24.21.0', GOOD_NODE);
  let downloads = 0;
  const download = async (_url, to) => {
    downloads += 1;
    cpSync(archive, to);
  };
  const out = join(dir, 'dist');
  const options = { root, out, platform: 'linux', arch: 'x64', commit: 'a1b2c3d4', build: false, manifest: manifest('24.21.0', sha256(archive)), download, ...quiet };
  const at = await pack(options);
  assert.deepEqual(listing(join(at, 'runtime')), ['LICENSE', 'bin', 'bin/node']); // npm, the headers and the docs left out
  assert.equal(readFileSync(join(at, 'bin/maws-session-host'), 'utf8'), 'linux host'); // P5 O16 M1
  assert.equal(JSON.parse(readFileSync(join(at, 'package.json'), 'utf8')).mawsd.node, '24.21.0');
  await pack(options);
  assert.equal(downloads, 1);
});

test('a runtime failing a smoke check refuses the pack, naming the check', async () => {
  const archive = fixtureArchive('24.21.0', '#!/bin/sh\ncase "$*" in *process.versions.node*) echo 24.21.0 ;; *node:sqlite*) echo "No such built-in module: node:sqlite" >&2; exit 1 ;; *.ts) echo 1 ;; esac\nexit 0\n');
  const download = async (_url, to) => cpSync(archive, to);
  const out = join(dir, 'dist');
  await assert.rejects(pack({ root, out, platform: 'linux', arch: 'x64', commit: 'a1b2c3d4', build: false, manifest: manifest('24.21.0', sha256(archive)), download, ...quiet }), /smoke check node:sqlite failed .*No such built-in module/);
  assert.deepEqual(packs(out), []);
});

test('a runtime of another version than the pin refuses the pack', async () => {
  const archive = fixtureArchive('24.21.0', GOOD_NODE.replace('echo 24.21.0', 'echo 24.20.0'));
  const download = async (_url, to) => cpSync(archive, to);
  await assert.rejects(pack({ root, out: join(dir, 'dist'), platform: 'linux', arch: 'x64', commit: 'a1b2c3d4', build: false, manifest: manifest('24.21.0', sha256(archive)), download, ...quiet }), /the runtime is Node 24.20.0, not the pinned 24.21.0/);
});

test('an architecture with no pinned runtime refuses the pack', async () => {
  await assert.rejects(pack({ root, out: join(dir, 'dist'), platform: 'linux', arch: 'ppc64', commit: 'a1b2c3d4', build: false, manifest: manifest('24.21.0', '0'.repeat(64)), download: async () => {}, ...quiet }), /no pinned Node runtime for linux-ppc64/);
});

test('the pinned runtime is Electron 44.4.5’s Node, 24.21.0, with a sha256 per Linux architecture', () => {
  const pinned = JSON.parse(readFileSync(new URL('../packaging/mawsd/node.json', import.meta.url), 'utf8'));
  assert.equal(pinned.version, '24.21.0');
  assert.deepEqual(Object.keys(pinned.sha256).sort(), ['linux-arm64', 'linux-x64']);
  for (const sum of Object.values(pinned.sha256)) assert.match(sum, /^[0-9a-f]{64}$/);
});

test('a Linux pack without a session host prebuild for its architecture is refused, and no pack is left (P5 O16 M1)', async () => {
  rmSync(join(root, 'native/session-host/prebuilds/linux-x64'), { recursive: true });
  const archive = fixtureArchive('24.21.0', GOOD_NODE);
  const out = join(dir, 'dist');
  await assert.rejects(
    pack({ root, out, platform: 'linux', arch: 'x64', commit: 'a1b2c3d4', build: false, manifest: manifest('24.21.0', sha256(archive)), download: async (_url, to) => cpSync(archive, to), ...quiet }),
    /no session host prebuild for linux-x64/,
  );
  assert.deepEqual(packs(out), []);
});
