// The committed schema fingerprint's file, for src/artifacts/document/fingerprint.test.ts: src/artifacts/ is portable
// and imports no Node module (§4.10's lint), so the test's file access and its update switch live here.
// Regenerate deliberately with `MAWS_UPDATE_FINGERPRINT=1 pnpm -C <worktree> exec vitest run src/artifacts/document/fingerprint.test.ts`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const FINGERPRINT_FILE = resolve(__dirname, '../../src/artifacts/document/fingerprint.json');
export const fingerprintUpdateRequested = (): boolean => process.env.MAWS_UPDATE_FINGERPRINT === '1';
export const readFingerprintFile = (): string | null => (existsSync(FINGERPRINT_FILE) ? readFileSync(FINGERPRINT_FILE, 'utf8') : null);
export const writeFingerprintFile = (text: string): void => writeFileSync(FINGERPRINT_FILE, text);
