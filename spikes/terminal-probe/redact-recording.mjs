// Redacts a `script -r` recording in place (C9 M1). The same secret sources as `spikes/protocol-probe/harness.mjs`
// (environment values under TOKEN/KEY/SECRET/PASSWORD names, `~/.claude/settings.json`'s env, `sk-ant-` keys, e-mail
// addresses), but every replacement keeps the byte length: a recording is a sequence of length-framed records and a
// shorter substitute would break `script -p`.
//
//   node spikes/terminal-probe/redact-recording.mjs recordings/claude.rec
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const secrets = (() => {
  const values = new Set();
  const add = (k, v) => {
    if (typeof v === 'string' && v.length >= 8 && /TOKEN|KEY|SECRET|PASSWORD/i.test(k)) values.add(v);
  };
  for (const [k, v] of Object.entries(process.env)) add(k, v);
  try {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(`${homedir()}/.claude/settings.json`, 'utf8')).env || {})) add(k, v);
  } catch {
    // no settings file, nothing to add
  }
  return [...values].sort((a, b) => b.length - a.length);
})();

const sameLength = (match) => 'X'.repeat(Buffer.byteLength(match)).slice(0, match.length).padEnd(match.length, 'X');

export function redactRecording(buffer) {
  let text = buffer.toString('latin1'); // byte-preserving
  let hits = 0;
  for (const secret of secrets) {
    const latin = Buffer.from(secret).toString('latin1');
    if (text.includes(latin)) {
      hits += text.split(latin).length - 1;
      text = text.split(latin).join(sameLength(latin));
    }
  }
  text = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, (m) => {
    hits++;
    return `sk-ant-${'X'.repeat(m.length - 7)}`;
  });
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g, (m) => {
    if (/@(localhost|redacted\.invalid)$/.test(m)) return m;
    hits++;
    return sameLength(m);
  });
  return { buffer: Buffer.from(text, 'latin1'), hits };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  for (const file of process.argv.slice(2)) {
    const { buffer, hits } = redactRecording(readFileSync(file));
    writeFileSync(file, buffer);
    console.log(`${file}: ${hits} replacement(s), ${buffer.length} bytes`);
  }
}
