// Public CI evidence, not a profile backup. Keep only the two main-process streams and the engine host's log.
// Raw errors can contain upstream responses or account data: credentialed/owner scenes opt out, not regex-redact.
import { randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
        writeFileSync(file, '');
        streams.push(file);
        const receive = (chunk) => appendFileSync(file, chunk);
        stream.on('data', receive); // additive: quit specs and scene hooks keep their own listeners and bytes
        listeners.push(() => stream.off('data', receive));
      }
    },
    finish() {
      if (finished) return;
      finished = true;
      for (const remove of listeners) remove();
      // Utility hosts (artifacts-perf) have no file: main/hosts/supervisor.ts forwards their lines with this prefix.
      // Extract after the measurement, from complete bytes already captured. Streams retain their own line order.
      const utilityLines = streams.flatMap((file) => readFileSync(file, 'utf8').split('\n').filter((line) => line.startsWith('[engine-host] ')));
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
