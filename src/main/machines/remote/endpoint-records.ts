// A machine's endpoint record, as the RL2 link dials it (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Endpoint records"; RL6, RL §4.1): fetched from the hub at each connection attempt, verified against the held org view,
// the newest `issued` kept. It is cached in memory and in `<userData>/endpoint-records.json` (0600, written through a
// temporary file and a rename), so a hub outage, even across a relaunch, still dials direct (P5 §3). Every record is
// verified again at each use, the file's included: the machine's key may have been retired since it was written.
import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isEndpointRecord, isSigned, verifyEndpointRecord, type EndpointRecord, type Signed } from '../../../../apps/org-protocol/src/index.ts';
import type { MachineRef } from '@shared/machine/ref';
import type { SignedIn } from '../../org/session';
import { REMOTE_TIMING } from './timing';

export const ENDPOINT_RECORDS_FILE = 'endpoint-records.json';

export interface EndpointRecords {
  /**
   * The newest record for `ref` that verifies against `signedIn.view` now: fetched from the hub within RECORD_FETCH_MS
   * when it answers, else the cache (memory, then the file); null when neither holds one. A fetched record replaces the
   * cached one only when its `issued` is later.
   */
  resolve(ref: MachineRef, signedIn: SignedIn): Promise<Signed<EndpointRecord> | null>;
}

type RecordsFile = { version: 1; records: Record<string, Signed<EndpointRecord>> };

export function createEndpointRecords(deps: { file: string; fetch?: typeof fetch; now?(): number; fetchMs?: number; log(line: string): void }): EndpointRecords {
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const fetchMs = deps.fetchMs ?? REMOTE_TIMING.RECORD_FETCH_MS;
  let cache: Map<string, Signed<EndpointRecord>> | null = null;

  function load(): Map<string, Signed<EndpointRecord>> {
    if (cache !== null) return cache;
    cache = new Map();
    let text: string;
    try {
      text = readFileSync(deps.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') deps.log(`could not read ${deps.file}: ${(error as Error).message}; read as empty`);
      return cache;
    }
    try {
      const parsed = JSON.parse(text) as Partial<RecordsFile>;
      if (parsed.version !== 1 || typeof parsed.records !== 'object' || parsed.records === null) throw new Error('not a version 1 records file');
      for (const [ref, record] of Object.entries(parsed.records)) if (isSigned(record, isEndpointRecord)) cache.set(ref, record);
    } catch (error) {
      deps.log(`${deps.file} does not read (${(error as Error).message}); read as empty`);
    }
    return cache;
  }

  function persist(records: Map<string, Signed<EndpointRecord>>): void {
    const temp = `${deps.file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      const contents: RecordsFile = { version: 1, records: Object.fromEntries(records) };
      writeFileSync(temp, `${JSON.stringify(contents)}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(temp, deps.file);
    } catch (error) {
      rmSync(temp, { force: true });
      deps.log(`could not write ${deps.file}: ${(error as Error).message}`);
    }
  }

  async function verified(ref: MachineRef, record: Signed<EndpointRecord> | null | undefined, signedIn: SignedIn): Promise<boolean> {
    if (record === null || record === undefined || record.body.machine !== ref) return false;
    return (await verifyEndpointRecord(signedIn.view.head().state, record, signedIn.view.certificates(), new Date(now()))).ok;
  }

  async function fetched(ref: MachineRef, signedIn: SignedIn): Promise<Signed<EndpointRecord> | null> {
    const hub = signedIn.hub;
    if (hub === null) return null;
    const url = `${hub.url.replace(/\/+$/, '')}/api/machines/${encodeURIComponent(ref)}/endpoint`;
    try {
      const response = await fetchFn(url, { headers: await hub.headers(), signal: AbortSignal.timeout(fetchMs) });
      if (response.status !== 200) {
        await response.body?.cancel();
        return null;
      }
      const body = (await response.json()) as { record?: unknown };
      return isSigned(body.record, isEndpointRecord) ? body.record : null;
    } catch {
      return null;
    }
  }

  return {
    async resolve(ref, signedIn) {
      const records = load();
      const fresh = await fetched(ref, signedIn);
      const held = records.get(ref);
      const freshOk = await verified(ref, fresh, signedIn);
      const heldOk = await verified(ref, held, signedIn);
      if (freshOk && (!heldOk || Date.parse(fresh!.body.issued) > Date.parse(held!.body.issued))) {
        if (fresh!.body.issued !== held?.body.issued || !heldOk) {
          records.set(ref, fresh!);
          persist(records);
        }
        return fresh;
      }
      if (heldOk) return held!;
      if (fresh !== null && !freshOk) deps.log(`the hub's endpoint record for ${ref} does not verify; ignored`);
      return null;
    },
  };
}
