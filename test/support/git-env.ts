// Strip every inherited Git control variable before applying fixture-owned configuration.
export function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'MAWS Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@maws.invalid',
    GIT_COMMITTER_NAME: 'MAWS Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@maws.invalid',
    GIT_TERMINAL_PROMPT: '0',
  };
}

