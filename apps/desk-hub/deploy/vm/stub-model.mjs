// The lane A session's model in the endpoint acceptance scene (P5 O10 M11; scene.sh starts it): a stand-in for the
// Messages API on 127.0.0.1, so the terminal `claude` under the scene's sminos runs turns with no credential and no
// spend. Built on spikes/protocol-probe/stub-api.mjs's turn encoding (scene.sh ships it beside this file), answered by
// content rather than order, so a resumed session and any request the engine repeats get the same answers:
// - a main-loop request whose last user text says `o10-m11 ticks <k> <tag>` starts a tool loop: `echo o10-m11 tick
//   1/<k> <tag>` through Bash, and each tool result for tick i < k answers tick i + 1, the last a plain text turn; so
//   the session goes on writing rows by itself (two per tick) while the run cuts its links;
// - one whose last user text says `o10-m11 ask <tag>` asks a question: `touch /tmp/o10-m11-ask-<tag>` through Bash,
//   which the scene's settings don't allow, so the engine asks its owner (the bridge raises the request);
// - any other main-loop request is answered with a short text turn naming the request;
// - a side request (a title, a classifier) with a short text; count_tokens a fixed count; any other path 404.
// Each answer waits `--delay-ms` (default 700), so a run of ticks spreads over time. Usage:
//   node stub-model.mjs --port <port> [--delay-ms <ms>]
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createServer } from 'node:http';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { jsonOf, sseOf, textTurn, toolTurn } from './stub-api.mjs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const port = Number(arg('port', '47899'));
const delayMs = Number(arg('delay-ms', '700'));
const TICKS = /o10-m11 ticks (\d{1,3}) ([a-z0-9]{1,16})/;
const TICK = /o10-m11 tick (\d{1,3})\/(\d{1,3}) ([a-z0-9]{1,16})/;
const ASK = /o10-m11 ask ([a-z0-9]{1,24})/;

/** The text of a message's content, tool results included. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (block?.type === 'text') return block.text ?? '';
      if (block?.type === 'tool_result') return textOf(block.content);
      return '';
    })
    .join('\n');
}

const isMainLoop = (body) => Array.isArray(body.tools) && body.tools.some((t) => t?.name === 'Bash');

/** The turn a main-loop request gets: decided by its last user message alone. */
export function answer(body) {
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
  const text = textOf(last?.content);
  const tick = TICK.exec(text);
  if (tick) {
    const [, i, k, tag] = tick;
    if (Number(i) >= Number(k)) return textTurn(`o10-m11 ticks done ${tag}`);
    const next = Number(i) + 1;
    return toolTurn(`toolu_o10m11_${tag}_${next}`, 'Bash', { command: `echo o10-m11 tick ${next}/${k} ${tag}`, description: `tick ${next} of ${k}` });
  }
  const ask = ASK.exec(text);
  if (ask) return toolTurn(`toolu_o10m11_ask_${ask[1]}`, 'Bash', { command: `touch /tmp/o10-m11-ask-${ask[1]}`, description: 'a question for the owner' });
  const ticks = TICKS.exec(text);
  if (ticks) {
    const [, k, tag] = ticks;
    return toolTurn(`toolu_o10m11_${tag}_1`, 'Bash', { command: `echo o10-m11 tick 1/${k} ${tag}`, description: `tick 1 of ${k}` });
  }
  return textTurn(`o10-m11 stub: noted (${text.length} characters)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  let served = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = req.url.split('?')[0];
      if (req.method === 'POST' && path === '/v1/messages/count_tokens') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ input_tokens: 1000 }));
      }
      if (req.method !== 'POST' || path !== '/v1/messages') {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'stub' } }));
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400);
        return res.end();
      }
      const turn = isMainLoop(body) ? answer(body) : textTurn('o10-m11');
      const id = `msg_o10m11_${++served}`;
      console.log(`${new Date().toISOString()} ${isMainLoop(body) ? 'main' : 'side'} ${turn.stop} ${turn.blocks.map((b) => b.type).join(',')}`);
      setTimeout(() => {
        if (body.stream === true) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
          return res.end(sseOf(turn, { id, model: body.model }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(jsonOf(turn, { id, model: body.model })));
      }, isMainLoop(body) ? delayMs : 0);
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`stub model on 127.0.0.1:${port}`));
}
