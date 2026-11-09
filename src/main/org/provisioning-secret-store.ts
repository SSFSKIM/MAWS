// The provisioning code's destination (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The
// destination"; the controller's ruling on Task 3's piece 4): the Secret Manager secret a new delegation's code goes to,
// as a new version, set once on this machine. It lives in a file of main's own, `<profile>/provisioning-secret.json`
// (`{version: 1, provisioningSecret: {project, secret, account} | null}`), and never in `settings.json` or
// `machine-settings.json`: an older build strict-parses those, and a property it doesn't know makes it substitute
// defaults for the whole file and refuse its writes (O7 M9, "The default, without a v2"). Only main runs gcloud, so main
// is this file's one reader and writer; no `mawsd`, engine host or older build reads it.
//
// It keeps the settings files' rules (src/shared/settings/file-store.ts: a missing file is a first run; a write is
// validated, then replaces the file whole, owner-only; a file this build can't own is never written over), with one
// difference the ruling asks for: `openSettingsFile` shows defaults for a file it can't read, and here that file reads
// `damaged`, never null, so a damaged destination is never taken for an unset one. Each read is the file's as it stands.
//
// Electron-free: vitest's node project runs it.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as z from 'zod';
import { ProvisioningSecretSchema, type ProvisioningSecret } from '@shared/ipc/schema/org';
import { writeSettingsFile } from '@shared/settings/file-store';

export const PROVISIONING_SECRET_FILE = 'provisioning-secret.json';
const FILE_VERSION = 1;
const FileSchema = z.strictObject({ version: z.literal(FILE_VERSION), provisioningSecret: ProvisioningSecretSchema.nullable() });

/** The destination as the file holds it (null: absent, or cleared), or why the file isn't one this build can own. */
export type DestinationReading = { ok: true; value: ProvisioningSecret | null } | { ok: false; damaged: string };
/**
 * A write's answer: the value now held, or why nothing was written: `invalid`, a value out of its grammar; `damaged`,
 * the file is one this build can't own (it is never written over); `io`, the disk refused the write.
 */
export type DestinationWrite = { ok: true; value: ProvisioningSecret | null } | { ok: false; reason: 'invalid' | 'damaged' | 'io'; detail: string };

export interface ProvisioningSecretStore {
  read(): DestinationReading;
  write(value: ProvisioningSecret | null): DestinationWrite;
}

/** `file`: `<profile>/provisioning-secret.json` (`PROVISIONING_SECRET_FILE`); its directory is made at the first write. */
export function openProvisioningSecret(file: string): ProvisioningSecretStore {
  const name = basename(file);

  function read(): DestinationReading {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ok: true, value: null };
      return { ok: false, damaged: `${name} can't be read (${code ?? (error as Error).message})` };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, damaged: `${name} is not JSON` };
    }
    const parsed = FileSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, damaged: `${name} is not a version ${FILE_VERSION} destination this build reads` };
    return { ok: true, value: parsed.data.provisioningSecret };
  }

  return {
    read,
    write(value) {
      const checked = ProvisioningSecretSchema.nullable().safeParse(value);
      if (!checked.success) return { ok: false, reason: 'invalid', detail: 'the destination is not a project, a secret and an account in their grammar' };
      const held = read();
      if (!held.ok) return { ok: false, reason: 'damaged', detail: `${held.damaged}: it is not written over` };
      try {
        writeSettingsFile(file, { version: FILE_VERSION, provisioningSecret: checked.data });
      } catch (error) {
        return { ok: false, reason: 'io', detail: `${name} can't be written (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})` };
      }
      return { ok: true, value: checked.data };
    },
  };
}
