// Public CI evidence, not a profile backup. Keep only the two main-process streams and the engine host's log.
// Raw errors can contain upstream responses or account data: credentialed/owner scenes opt out, not regex-redact.
import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, copyFileSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Settings' explicit binary precedes the e2e environment (engine-host/binary-info.ts). The machine file is
// authoritative; profiles predating its split still hold the override in settings.json. Read at most 256 KiB + 1.
function configuredEngineBin(userData) {
  for (const name of ['machine-settings.json', 'settings.json']) {
    let fd;
    try {
      fd = openSync(join(userData, name), 'r');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    try {
      const bytes = Buffer.alloc(256 * 1024 + 1);
      const size = readSync(fd, bytes, 0, bytes.length, 0);
      if (size === bytes.length) throw new Error('settings exceed evidence read budget');
      const settings = JSON.parse(bytes.subarray(0, size).toString('utf8'));
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('invalid settings');
      if (name === 'settings.json' && settings.engine === undefined) return null; // a post-split client file
      const engine = settings.engine;
      if (!engine || typeof engine !== 'object' || Array.isArray(engine)) throw new Error('invalid engine settings');
      const bin = engine.binaryPath;
      if (bin !== null && (typeof bin !== 'string' || !bin)) throw new Error('invalid engine binary');
      return bin;
    } finally {
      closeSync(fd);
    }
  }
  return null; // a fresh profile uses the known environment binary
}

export function captureAllowed({ file, env, userData, syntheticEngineBin, realEngine = false, ownerConfigHome = false }) {
  // Fail closed for installed engines and unknown overrides, including wrappers around a real engine. The caller
  // identifies one test-owned synthetic binary; settings and environment must resolve to that exact binary.
  if (!syntheticEngineBin || env.MAWS_E2E !== '1' || realEngine || ownerConfigHome) return false;
  const privateGroups = ['LIVE_E2E', 'LIVE_GUARD_E2E', 'MAC_SECRET_E2E'].flatMap((key) => (env[key] ?? '').split(/\s+/).filter(Boolean));
  if (privateGroups.includes(env.MAWS_E2E_GROUP)) return false;
  // Local Playwright runs do not have gate.yml's group lists. These scenes use a real engine or real account state.
  if (/(?:^|-)live(?:-|\.spec\.ts$)|^(?:c12-prerun|connectors-oauth|discover)\.spec\.ts$/.test(basename(file))) return false;
  if (Object.entries(env).some(([key, value]) => /^MAWS_.*LIVE/.test(key) && value === '1')) return false;
  try {
    const configured = userData === undefined ? null : configuredEngineBin(userData);
    return (configured ?? env.MAWS_E2E_ENGINE_BIN) === syntheticEngineBin;
  } catch {
    return false; // unreadable, malformed or oversized settings never authorize public raw logs
  }
}

// Per stream: 256 KiB of startup plus a 256 KiB rolling tail. Only the head is written during the run; cleanup
// flushes the tail and an exact dropped-byte marker. Neither retained memory nor disk grows with the run's output.
const STREAM_PART_BYTES = 256 * 1024;
const utilityLinesOf = (bytes) => bytes.toString('utf8').split('\n').filter((line) => line.startsWith('[engine-host] '));
function boundedStream(file) {
  const head = Buffer.alloc(STREAM_PART_BYTES);
  const tail = Buffer.alloc(STREAM_PART_BYTES);
  let headBytes = 0;
  let tailBytes = 0;
  let cursor = 0;
  let total = 0;
  writeFileSync(file, '');
  return {
    file,
    receive(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      const take = Math.min(head.length - headBytes, bytes.length);
      if (take) {
        bytes.copy(head, headBytes, 0, take);
        headBytes += take;
        appendFileSync(file, bytes.subarray(0, take));
      }
      const rest = bytes.subarray(take);
      if (rest.length >= tail.length) {
        tail.set(rest.subarray(-tail.length));
        tailBytes = tail.length;
        cursor = 0;
      } else if (rest.length) {
        const first = Math.min(rest.length, tail.length - cursor);
        tail.set(rest.subarray(0, first), cursor);
        tail.set(rest.subarray(first), 0);
        cursor = (cursor + rest.length) % tail.length;
        tailBytes = Math.min(tail.length, tailBytes + rest.length);
      }
    },
    finish() {
      const start = head.subarray(0, headBytes);
      const end = tailBytes < tail.length ? tail.subarray(0, tailBytes) : Buffer.concat([tail.subarray(cursor), tail.subarray(0, cursor)]);
      const dropped = total - headBytes - tailBytes;
      const marker = dropped ? `\n[process-evidence: dropped ${dropped} bytes]\n` : '';
      appendFileSync(file, Buffer.concat([Buffer.from(marker), end]));
      // Extraction uses retained bytes, never rereads/splits a growing file (also for detached hosts). A truncation
      // boundary may cut a line: leave its fragments in raw evidence but don't invent complete utility-host lines.
      if (!dropped) return utilityLinesOf(Buffer.concat([start, end]));
      const first = utilityLinesOf(start.subarray(0, start.lastIndexOf(10) + 1));
      const last = end.indexOf(10) < 0 ? [] : utilityLinesOf(end.subarray(end.indexOf(10) + 1));
      return first.length || last.length ? [...first, marker.trim(), ...last] : [];
    },
  };
}

export function processEvidence(outputDir, userData, canKeep = () => true) {
  mkdirSync(outputDir, { recursive: true });
  const id = randomUUID(); // distinct even for relaunches over the same profile, and retries have their own outputDir
  const stage = join(userData, `.process-evidence-${id}`); // never uploaded if the worker dies before the final check
  const listeners = [];
  const streams = [];
  let finished = false;
  return {
    capture(child) {
      mkdirSync(stage, { recursive: true, mode: 0o700 });
      for (const name of ['stdout', 'stderr']) {
        const stream = child[name];
        if (!stream) continue;
        const file = join(stage, `main-process-${id}.${name}.log`);
        const capture = boundedStream(file);
        streams.push(capture);
        stream.on('data', capture.receive); // additive: quit specs and scene hooks keep their own listeners and bytes
        listeners.push(() => stream.off('data', capture.receive));
      }
    },
    finish() {
      if (finished) return;
      finished = true;
      for (const remove of listeners) remove();
      try {
        // Settings can change after launch. Only publish after rechecking; worker death before finish leaves raw
        // streams private, not in test-results for a red/cancelled job's artifact upload.
        if (!canKeep()) {
          writeFileSync(join(outputDir, `engine-host-${id}.excluded.log`), 'Raw process evidence excluded: engine provenance could not be verified.\n');
          return;
        }
        // Utility hosts (artifacts-perf) have no file: main/hosts/supervisor.ts forwards their lines with this prefix.
        // Extract after the measurement, within each stream's head/tail budget. Streams retain their own line order.
        const utilityLines = streams.flatMap((stream) => stream.finish());
        for (const { file } of streams) copyFileSync(file, join(outputDir, basename(file)));
        if (utilityLines.length) writeFileSync(join(outputDir, `engine-host-${id}.utility.log`), `${utilityLines.join('\n')}\n`);
        // Called after the profile's processes stop, before its directory is removed. An early failed launch or a
        // utility-mode host may have no file. The rotated generation uses .log too so the narrow upload catches it.
        for (const [source, suffix] of [['host.log', ''], ['host.log.1', '.previous']]) {
          try {
            copyFileSync(join(userData, 'supervisor', source), join(outputDir, `engine-host-${id}${suffix}.log`));
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
      } finally {
        rmSync(stage, { recursive: true, force: true });
      }
    },
  };
}

// The heavy guard is scripted, not a paid engine run. Persist only timing fields, never its journal's tool payloads.
export function writeTimingEvidence(file, spans, unanswered, loadavg) {
  mkdirSync(dirname(file), { recursive: true });
  const call = ({ name, requestSeq, startedAt, toolUseId }) => ({ name, requestSeq, startedAt, toolUseId: toolUseId ?? null });
  writeFileSync(file, `${JSON.stringify({
    spans: spans.map((span) => ({ ...call(span), responseSeq: span.responseSeq, answeredAt: span.answeredAt, ms: span.ms })),
    unanswered: unanswered.map(call),
    loadavg,
  }, null, 2)}\n`);
}
