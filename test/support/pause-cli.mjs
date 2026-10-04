import process from 'node:process';
// No model: the real CLI's terminal job-control dance plus its holder registry shape.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [config, sessionId, log] = process.argv.slice(2);
const note = (event) => appendFileSync(log, `${JSON.stringify({ event, pid: process.pid, at: Date.now() })}\n`);
mkdirSync(join(config, 'sessions'), { recursive: true });
const procStart = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8' }).trim();
writeFileSync(join(config, 'sessions', `${process.pid}.json`), JSON.stringify({ sessionId, cwd: process.cwd(), startedAt: Date.now(), procStart, kind: 'interactive', entrypoint: 'cli', version: '2.1.287' }));
const repaint = () => { process.stdin.setRawMode(true); process.stdout.write('\x1b[?1049h\x1b[?2004h\x1b]0;W14 CLI\x07W14 CLI ready\r\n'); };
process.on('SIGCONT', () => { repaint(); note('continued'); });
process.stdin.on('data', (data) => {
  if (!data.includes(0x1a)) return;
  process.stdin.setRawMode(false);
  process.stdout.write('\x1b[?2004l\x1b[?1049l\x1b[?25h');
  note('suspended');
  process.kill(0, 'SIGTSTP');
});
repaint();
note('ready');
