// The engine version MAWS's fixtures were recorded on, and its file (charter D-1 as amended 2026-10-01, W13): test
// only. The product runs the user's installed Claude Code; the live harness, the live e2e specs, the conformance
// harness, the probe runner and MAWS_E2E's default engine use this pin. Self-contained (Node imports only), because the
// probe runner's .mjs imports it directly. Recording fixtures on a newer version is a probe wave of its own.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ENGINE_VERSION = '2.1.283';
export const ENGINE_BIN = join(homedir(), '.local/share/claude/versions', ENGINE_VERSION); // the installer keeps its five newest versions
