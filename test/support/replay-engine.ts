// Replay still traverses the product's binary/version launch gate. Its scratch binary must never run a real turn.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';

export function writeReplayEngine(userData: string): string {
  const path = join(userData, 'replay-engine');
  writeFileSync(path, `#!/bin/sh
if [ "$#" = 1 ] && [ "$1" = "--version" ]; then
  echo "${FIXTURE_ENGINE_VERSION} (Claude Code)"
  exit 0
fi
echo "MAWS replay-only engine: refusing a real invocation" >&2
exit 64
`, { mode: 0o755 });
  return path;
}
