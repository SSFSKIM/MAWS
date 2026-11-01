// U3's Linux runner (spikes/u3-remote-browser/linux/run.sh, P5 O5 M7): the fallback Electron it fetches is checked against
// the release's SHASUMS256.txt, and a zip that fails the check, or a fetch that fails, stops it before anything is
// unpacked (the runner goes on to set the unpacked helper root-owned SUID and to run Electron). The fetch-and-verify step
// is sourced from the script and run with a file:// url and `unzip` faked, so no network and no real zip.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RUN_SH = resolve(__dirname, '../../spikes/u3-remote-browser/linux/run.sh');
const ZIP = 'electron-v1.0.0-linux-x64.zip';
const BYTES = 'a zip of electron 1.0.0 for linux-x64';

let dir: string;
let from: string;
let into: string;
let unzipped: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-u3-run-'));
  from = join(dir, 'release');
  into = join(dir, 'u3');
  const bin = join(dir, 'bin');
  for (const at of [from, into, bin]) mkdirSync(at);
  unzipped = join(dir, 'unzipped');
  writeFileSync(join(bin, 'unzip'), `#!/bin/sh\ntouch '${unzipped}'\n`);
  chmodSync(join(bin, 'unzip'), 0o755);
  writeFileSync(join(from, ZIP), BYTES);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sums = (sha256: string) => writeFileSync(join(from, 'SHASUMS256.txt'), `${sha256} *${ZIP}\n`);
const fetchElectron = () =>
  spawnSync('bash', ['-c', 'source "$1" && fetch_electron "$2" "$3" "$4"', 'run.sh', RUN_SH, into, ZIP, `file://${from}`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}` },
  });

describe('the U3 Linux runner’s Electron fetch', () => {
  it('stops before unzip when the zip’s sha256 is not the release’s', () => {
    sums('0'.repeat(64));
    const fetched = fetchElectron();
    expect(fetched.status).not.toBe(0);
    expect(existsSync(unzipped), 'unzip ran on a zip that failed its check').toBe(false);
    expect(existsSync(join(into, 'electron'))).toBe(false);
  });

  it('stops before unzip when the sums cannot be fetched', () => {
    const fetched = fetchElectron(); // no SHASUMS256.txt beside the zip
    expect(fetched.status).not.toBe(0);
    expect(existsSync(unzipped)).toBe(false);
  });

  it('unpacks a zip that matches the release’s sums', () => {
    sums(createHash('sha256').update(BYTES).digest('hex'));
    const fetched = fetchElectron();
    expect(fetched.status, fetched.stderr).toBe(0);
    expect(existsSync(unzipped)).toBe(true);
  });
});
