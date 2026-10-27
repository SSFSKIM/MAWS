// Acceptance 8's staging check holds the owner's Access token as a browser cookie (e2e-staging/), so nothing may turn
// Playwright's recording back on for it: its configuration refuses any command-line option beyond naming itself, and
// any Playwright variable in the environment (PWDEBUG, PW_*, PLAYWRIGHT_*), before a test runs.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { refuseRecording } from '../e2e-staging/recording';

const cli = '/repo/node_modules/@playwright/test/cli.js';

describe('the staging check’s Playwright run', () => {
  it('is the configuration named, and nothing else', () => {
    for (const argv of [
      ['node', cli, 'test', '-c', 'playwright.staging.config.ts'],
      ['node', cli, 'test', '--config', 'playwright.staging.config.ts'],
      ['node', cli, 'test', '--config=playwright.staging.config.ts'],
    ]) {
      expect(() => refuseRecording(argv, {})).not.toThrow();
    }
  });

  it('refuses an option that could record or show the run, in any form', () => {
    for (const extra of [['--trace=on'], ['--trace', 'on'], ['--video=on'], ['--debug'], ['--ui'], ['--headed'], ['--reporter=html'], ['-x'], ['e2e-staging/desk-web.spec.ts']]) {
      expect(() => refuseRecording(['node', cli, 'test', '-c', 'playwright.staging.config.ts', ...extra], {}), extra.join(' ')).toThrow(/refusing/);
    }
  });

  it('refuses any Playwright variable in the environment', () => {
    for (const env of [{ PWDEBUG: '1' }, { PWDEBUG: '' }, { PW_TEST_REPORTER: 'html' }, { PLAYWRIGHT_HTML_REPORT: '/tmp/x' }, { PLAYWRIGHT_BROWSERS_PATH: '/tmp/b' }]) {
      expect(() => refuseRecording(['node', cli, 'test', '-c', 'playwright.staging.config.ts'], env), Object.keys(env)[0]).toThrow(/refusing/);
    }
  });
});

/** Every file under `dir`, recursively. */
const filesUnder = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f)).filter((f) => statSync(f).isFile());

describe('a failing staging check', () => {
  // Playwright writes error-context.md for a failed test, with an accessibility snapshot of the page, whatever the
  // configuration's trace, video and screenshot say; the page may be showing the Machines dialog's enrollment code,
  // which holds the org key. The check's `test` (e2e-staging/unrecorded.ts) writes nothing of the kind. Run here in
  // Playwright itself, through that `test`: the files a failed test leaves in the output directory.
  const probe = (test: string) => {
    const secret = `smns-enroll-v1.${randomUUID()}`;
    const out = mkdtempSync(join(tmpdir(), 'staging-unrecorded-'));
    const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
    const run = spawnSync(process.execPath, [cli, 'test', '-c', join(import.meta.dirname, 'fixtures/staging-unrecorded/probe.config.ts'), '--grep', test], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir(), PROBE_SECRET: secret, PROBE_OUT: out },
      timeout: 90_000,
    });
    const written = filesUnder(out).filter((f) => !f.endsWith('.last-run.json'));
    return { run, output: run.stdout + run.stderr, written, holding: filesUnder(out).filter((f) => readFileSync(f, 'utf8').includes(secret)) };
  };

  it('leaves no error context', () => {
    const { run, output, written } = probe('fails without a page');
    expect(run.status, output).toBe(1);
    expect(run.stdout).toMatch(/1 failed/);
    expect(written).toEqual([]);
  }, 120_000);

  // Needs Playwright's Chromium (`pnpm --filter desk-web exec playwright install chromium`), which the staging check
  // runs in; skipped where it is not installed.
  it('leaves nothing holding what the page showed: no page snapshot, no failure screenshot', (context) => {
    const { run, output, written, holding } = probe('secret on the page');
    if (/Executable doesn't exist/.test(output)) context.skip();
    expect(run.status, output).toBe(1);
    expect(run.stdout).toMatch(/1 failed/);
    expect(written).toEqual([]);
    expect(holding).toEqual([]);
  }, 120_000);
});
