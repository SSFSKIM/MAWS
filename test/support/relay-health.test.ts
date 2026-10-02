import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, test } from 'vitest';
import { relaySkipReason } from './relay-health';

// A disposable child server can respond while the caller is blocked in synchronous curl.
// Never contact ClaudeUsage's real relay.
test('relay gate bounds a silent server and skips refusal/non-200 responses', async () => {
  const server = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/hang/')) return;
      res.writeHead(req.url.startsWith('/bad/') ? 503 : 200); res.end();
    });
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(server, 'exit');
  const [chunk] = await once(server.stdout!, 'data');
  const url = `http://127.0.0.1:${Number(String(chunk).trim())}`;
  try {
    expect(relaySkipReason(url)).toBeNull();
    expect(relaySkipReason(`${url}/bad`)).toContain('503');
    const started = Date.now();
    expect(relaySkipReason(`${url}/hang`, 100)).toContain('timed out');
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    server.kill();
    await exited;
  }
  expect(relaySkipReason(url, 100)).toContain('unavailable');
});
