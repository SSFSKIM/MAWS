// The live harness's public-output boundary: exported journals and sitting notes use the same redactor.
// Raw engine journals remain faithful in their private scratch profiles; only copies/notes are sanitized.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export function createRedactor(env) {
  const secrets = Object.entries(env)
    .filter(([key, value]) => /TOKEN|KEY|SECRET|PASSWORD/i.test(key) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join('[REDACTED]');
    return out
      .replace(/\b(Bearer[ \t]+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
      .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[REDACTED]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g, (m) => (/@(localhost|[A-Za-z0-9.-]+\.(test|example|invalid))$/.test(m) ? m : 'owner@redacted.invalid'));
  };
}

export function redactJournal(text, env = process.env) {
  const redact = createRedactor(env);
  return text.split('\n').map((line) => redact(line)).join('\n');
}

export function sittingLog(dir, sitting, env = process.env) {
  const file = join(dir, `live-${sitting}.txt`);
  const redact = createRedactor(env);
  return (line) => {
    const safe = redact(line);
    mkdirSync(dir, { recursive: true });
    appendFileSync(file, `${safe}\n`);
    console.log(`   [${sitting}] ${safe}`);
  };
}
