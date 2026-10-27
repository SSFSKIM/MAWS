// The staging check's run records nothing (playwright.staging.config.ts): the browser holds the owner's Access token as
// a cookie, so a trace, a video, a HAR or a debugging session would carry it. The configuration sets every recording
// off, and this refuses what could turn one back on — a command-line option beyond naming the configuration, or a
// Playwright variable in the environment — before anything runs.

/** Throws unless the run is `playwright test` naming its configuration and nothing more, with no Playwright variable
 * (PWDEBUG, PW_*, PLAYWRIGHT_*) set. */
export function refuseRecording(argv: readonly string[], env: Record<string, string | undefined>): void {
  const variables = Object.keys(env).filter((name) => name === 'PWDEBUG' || name.startsWith('PW_') || name.startsWith('PLAYWRIGHT_'));
  if (variables.length > 0) throw new Error(`the staging check runs with no Playwright variable set (found ${variables.join(', ')}): refusing`);
  const options = argv.slice(argv.indexOf('test') + 1);
  const named = (options.length === 2 && (options[0] === '-c' || options[0] === '--config')) || (options.length === 1 && options[0].startsWith('--config='));
  if (!named) throw new Error(`the staging check takes no option but its configuration (given: ${options.join(' ') || 'none'}): refusing`);
}
