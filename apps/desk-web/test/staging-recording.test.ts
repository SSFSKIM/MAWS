// Acceptance 8's staging check holds the owner's Access token as a browser cookie (e2e-staging/), so nothing may turn
// Playwright's recording back on for it: its configuration refuses any command-line option beyond naming itself, and
// any Playwright variable in the environment (PWDEBUG, PW_*, PLAYWRIGHT_*), before a test runs.
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
