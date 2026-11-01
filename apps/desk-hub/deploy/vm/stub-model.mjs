// The model of the endpoint acceptance scene's sessions (P5 O10 M11; scene.sh starts it): a stand-in for the Messages API
// on 127.0.0.1, so the terminal `claude` under the scene's sminos (lane A) and the engine mawsd's engine host launches
// (lane B) run turns with no credential and no spend. Built on spikes/protocol-probe/stub-api.mjs's turn encoding
// (scene.sh ships it beside this file), answered by content rather than order, so a resumed session and any request the
// engine repeats get the same answers:
// - a main-loop request whose last user text says `o10-m11 ticks <k> <tag>` starts a tool loop: `echo o10-m11 tick
//   1/<k> <tag>` through Bash, and each tool result for tick i < k answers tick i + 1, the last a plain text turn; so
//   the session goes on writing rows by itself (two per tick) while the run cuts its links;
// - a main-loop request of the holder's acceptance run (P5 O16 M4; its first message `o16-holder go <tag> <s>`) gets
//   the holder run's script (`holderStep`, below): a background `sleep <s>`, a Bash call that raises a permission, the turn's
//   text, then the text answering the shell's completion;
// - any other main-loop request is answered with a short text turn naming the request;
// - a side request (a title, a classifier) with a short text; count_tokens a fixed count; the relay's health check
//   (GET /api/hello) 200, so a MAWS gateway launch pointed here by MAWS_RELAY_URL (lane B's engine) starts; any other
//   path 404.
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

// P5 O16 M4: the holder's acceptance run (holder.mjs).
const GO = /o16-holder go ([a-z0-9]{1,16}) (\d{1,4})/;

/**
 * The holder run's next model step for a main-loop request, or null when the conversation is not the run's: decided by
 * the run's first message and the last assistant message alone, so a request the engine repeats gets the same answer.
 *   the first request              Bash `sleep <s>` in the background
 *   after that tool's result        Bash `curl` to a closed port, which no rule allows: the permission
 *   after the permission's tool     the turn's text, `o16-holder done <tag>`
 *   after that, a new turn: `o16-holder notified <tag>` for the engine's notification that the run's own shell
 *     completed, else `o16-holder unrelated <tag>`
 */
export function holderStep(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const first = messages.find((m) => m?.role === 'user');
  const go = GO.exec(textOf(first?.content));
  if (!go) return null;
  const [, tag, seconds] = go;
  const last = [...messages].reverse().find((m) => m?.role === 'assistant');
  if (!last) return { tool: { id: `toolu_o16_${tag}_bg`, name: 'Bash', input: { command: `sleep ${seconds}`, run_in_background: true, description: `o16 holder background sleep ${tag}` } } };
  const used = (Array.isArray(last.content) ? last.content : []).filter((b) => b?.type === 'tool_use').map((b) => b.id);
  if (used.includes(`toolu_o16_${tag}_bg`)) return { tool: { id: `toolu_o16_${tag}_ask`, name: 'Bash', input: { command: `curl -sS --max-time 2 http://127.0.0.1:9/o16-holder-${tag}`, description: `o16 holder permission ${tag}` } } };
  if (used.includes(`toolu_o16_${tag}_ask`)) return { text: `o16-holder done ${tag}` };
  // A turn of its own after the run's turn: `notified` only for the engine's notification that the run's own shell (the
  // task id its tool result named) completed; anything else, another task's, a failed or killed one, a person's message,
  // gets a text the driver never accepts.
  const task = /Command running in background with ID: ([A-Za-z0-9_-]+)/.exec(resultOf(messages, `toolu_o16_${tag}_bg`))?.[1];
  const lastUser = textOf([...messages].reverse().find((m) => m?.role === 'user')?.content);
  const notes = lastUser.match(/<task-notification>[\s\S]*?<\/task-notification>/g) ?? [];
  const completed = task !== undefined && notes.some((note) => note.includes(`<task-id>${task}</task-id>`) && note.includes(`<tool-use-id>toolu_o16_${tag}_bg</tool-use-id>`) && note.includes('<status>completed</status>'));
  return { text: `o16-holder ${completed ? 'notified' : 'unrelated'} ${tag}` };
}

/** The text of the tool result answering `toolUseId`, or ''. */
function resultOf(messages, toolUseId) {
  for (const m of messages) {
    if (m?.role !== 'user' || !Array.isArray(m.content)) continue;
    const block = m.content.find((b) => b?.type === 'tool_result' && b.tool_use_id === toolUseId);
    if (block) return textOf(block.content);
  }
  return '';
}

const isMainLoop = (body) => Array.isArray(body.tools) && body.tools.some((t) => t?.name === 'Bash');

/** The turn a main-loop request gets: decided by its last user message alone. */
export function answer(body) {
  const step = holderStep(body);
  if (step) return step.tool ? toolTurn(step.tool.id, step.tool.name, step.tool.input) : textTurn(step.text);
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
  const text = textOf(last?.content);
  const tick = TICK.exec(text);
  if (tick) {
    const [, i, k, tag] = tick;
    if (Number(i) >= Number(k)) return textTurn(`o10-m11 ticks done ${tag}`);
    const next = Number(i) + 1;
    return toolTurn(`toolu_o10m11_${tag}_${next}`, 'Bash', { command: `echo o10-m11 tick ${next}/${k} ${tag}`, description: `tick ${next} of ${k}` });
  }
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
      if (req.method === 'GET' && path === '/api/hello') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
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
      const step = isMainLoop(body) ? holderStep(body) : null;
      if (step) {
        const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
        console.log(`${new Date().toISOString()} holder ${step.tool ? step.tool.id : JSON.stringify(step.text)} after ${JSON.stringify(textOf(last?.content).slice(0, 240))}`);
      }
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
