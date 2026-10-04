const BASE_KEYS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG'];

// The harness inherits process.env; retain only the base environment before a scratch launch.
export function clearEngineEnvironment() {
  for (const key of Object.keys(process.env)) if (!BASE_KEYS.includes(key) && !key.startsWith('LC_')) delete process.env[key];
}
