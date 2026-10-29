// Public CI evidence, not a profile backup. Keep only the two main-process streams and the engine host's log.
// Raw errors can contain upstream responses or account data: credentialed/owner scenes opt out, not regex-redact.
import { randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function captureAllowed({ file, env, syntheticEngineBin, realEngine = false, ownerConfigHome = false }) {
  // Fail closed for installed engines and unknown overrides, including wrappers around a real engine. The caller
  // identifies a test-owned synthetic binary; the final environment must still name that exact binary.
  if (!syntheticEngineBin || env.MAWS_E2E_ENGINE_BIN !== syntheticEngineBin || realEngine || ownerConfigHome) return false;
  const privateGroups = ['LIVE_E2E', 'LIVE_GUARD_E2E', 'MAC_SECRET_E2E'].flatMap((key) => (env[key] ?? '').split(/\s+/).filter(Boolean));
  if (privateGroups.includes(env.MAWS_E2E_GROUP)) return false;
  // Local Playwright runs do not have gate.yml's group lists. These scenes use a real engine or real account state.
  if (/(?:^|-)live(?:-|\.spec\.ts$)|^(?:c12-prerun|connectors-oauth|discover)\.spec\.ts$/.test(basename(file))) return false;
  if (Object.entries(env).some(([key, value]) => /^MAWS_.*LIVE/.test(key) && value === '1')) return false;
  return true;
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

export function processEvidence(outputDir, userData) {
  mkdirSync(outputDir, { recursive: true });
  const id = randomUUID(); // distinct even for relaunches over the same profile, and retries have their own outputDir
  const listeners = [];
  const streams = [];
  let finished = false;
  return {
    capture(child) {
      for (const name of ['stdout', 'stderr']) {
        const stream = child[name];
        if (!stream) continue;
        const file = join(outputDir, `main-process-${id}.${name}.log`);
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
      // Utility hosts (artifacts-perf) have no file: main/hosts/supervisor.ts forwards their lines with this prefix.
      // Extract after the measurement, within each stream's head/tail budget. Streams retain their own line order.
      const utilityLines = streams.flatMap((stream) => stream.finish());
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
