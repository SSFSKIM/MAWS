// P3-HD M4: the fixture server for route D's built-app disconnect scene (e2e/connectors-direct.spec.ts, "disconnect"). The
// scene's engine and MAWS's own connection both start the entry below from the scratch config home, through a wrapper
// that stands in for npx: a shell that stays the server's parent and leaves an EOF-ignoring grandchild beside it, each
// recording its pid, so the scene can tell the members of MAWS's instance from the engine's and prove none outlives
// main. The grandchild's command line names the scene's root, so a leak is caught and cleaned by the scene's own
// survivor check. Every value is a scratch fake; nothing of the owner's is read.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_SERVER } from './connector-engine';
import { TOOL, type ConnectorScene } from './connector-scene';
import { wrapperPids, type WrapperPids } from './connector-direct-transport';

export function wrapperLogOf(scene: ConnectorScene): string {
  return join(scene.root, 'wrapper.log');
}

// The fixture server's `mcpServers` entry: literal, the wrapper by absolute path, the call log the scene reads.
export function wrappedServer(scene: ConnectorScene): Record<string, unknown> {
  const bin = join(scene.root, 'bin');
  mkdirSync(bin, { recursive: true });
  const path = join(bin, 'npx-standin');
  writeFileSync(
    path,
    `#!/bin/sh\nprintf 'wrapper %s\\n' "$$" >> "$MAWS_PROBE_WRAPPER_LOG"\n/bin/sh -c 'while :; do /bin/sleep 1; done' "$MAWS_PROBE_SCENE_ROOT" </dev/null >/dev/null 2>&1 &\nprintf 'sleeper %s\\n' "$!" >> "$MAWS_PROBE_WRAPPER_LOG"\n${JSON.stringify(process.execPath)} "$@"\n`,
  );
  chmodSync(path, 0o755);
  return {
    type: 'stdio',
    command: path,
    args: [FIXTURE_SERVER, '--id', 'series', '--log', scene.log, '--tools', JSON.stringify([TOOL])],
    env: { MAWS_PROBE_WRAPPER_LOG: wrapperLogOf(scene), MAWS_PROBE_SCENE_ROOT: scene.root },
  };
}

// The wrappers and grandchildren started after `before` was read.
export function newMembers(scene: ConnectorScene, before: WrapperPids): WrapperPids {
  const now = wrapperPids(wrapperLogOf(scene));
  return { wrappers: now.wrappers.filter((pid) => !before.wrappers.includes(pid)), sleepers: now.sleepers.filter((pid) => !before.sleepers.includes(pid)) };
}
