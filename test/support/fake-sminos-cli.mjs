#!/usr/bin/env node
// The stand-in door (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §E): a test's `sminos`, named in
// MAWS_SMINOS_CLI by unit tests and e2e launches, so that no test reaches an installed sminos. It answers the
// locator's probe (`sheet show`) with exit 3, as the real command does for a session with no sheet. For `sheet put` it
// validates nothing: it appends the inbox lines on standard input to `<SMINOS_HOME>/sheet/<session>/inbox.jsonl` with
// `at` and, for more than one line, one `batch`, and prints `queued` for each. It never applies a line: §4.2's table has
// one implementation, the tool's.
//
// Its knobs, read from its environment (the login shell's, as MAWS runs the command):
// - FAKE_SMINOS_RAN: a file it appends its own path to at every start, so a test can say which executable ran, or none.
// - FAKE_SMINOS_EXIT: a `put` exits with that code and a line on standard error, appending nothing.
// - FAKE_SMINOS_RESULTS: a file a `put` prints, as it is, in place of the `queued` results.
// - FAKE_SMINOS_BARRIER: a `put` waits, before it appends, until that file exists: two windows' Sends are then both in
//   flight, each seen at the barrier, before either is appended.
// - The staged outcome: when `<SMINOS_HOME>/sheet/<session>.next/` exists it holds a fixture's `after` `state.json` and
//   `keys.json`, that fixture's own keys in inbox order. Each inbox line appended takes the place of the next of those
//   keys; once every place is taken, the record's `state.json` is replaced by the staged one, each of the fixture's keys
//   replaced by the key that took its place and `inbox.offset` set to the inbox's real length, and the staging is
//   removed. It replays a fixture's `after`; it computes no verdict.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const env = process.env;
if (env.FAKE_SMINOS_RAN) appendFileSync(env.FAKE_SMINOS_RAN, `${process.argv[1]}\n`);

const die = (code, text) => {
  process.stderr.write(`${text}\n`);
  process.exit(code);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const [verb, op, flag, session] = process.argv.slice(2);
if (verb !== 'sheet' || flag !== '--session' || !session) die(2, 'usage: sminos sheet put|show --session <id>');
if (op === 'show') die(3, `no sheet: ${session} has no question sheet on this machine`);
if (op !== 'put') die(2, `usage: sminos sheet put|show --session <id>`);

const input = readFileSync(0, 'utf8');
if (env.FAKE_SMINOS_EXIT) die(Number(env.FAKE_SMINOS_EXIT), `stand-in door: exit ${env.FAKE_SMINOS_EXIT}, as FAKE_SMINOS_EXIT asks`);
if (env.FAKE_SMINOS_BARRIER) while (!existsSync(env.FAKE_SMINOS_BARRIER)) await sleep(20);

const home = env.SMINOS_HOME;
if (!home) die(1, 'stand-in door: no SMINOS_HOME');
const sheet = join(home, 'sheet');
const record = join(sheet, session);
if (!existsSync(join(record, 'state.json'))) die(3, `no sheet: ${session} has no question sheet on this machine`);

const lines = input.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line));
const at = new Date().toISOString();
const batch = lines.length > 1 ? randomUUID().replaceAll('-', '') : undefined;
const stamped = lines.map((line) => ({ ...line, at, ...(batch === undefined ? {} : { batch }) }));

// One writer at a time, as the real door holds the record's lock: the append and the places it takes go together.
const lock = join(sheet, `${session}.fake-lock`);
for (;;) {
  try {
    mkdirSync(lock);
    break;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await sleep(10);
  }
}
try {
  const inbox = join(record, 'inbox.jsonl');
  appendFileSync(inbox, stamped.map((line) => `${JSON.stringify(line)}\n`).join(''), { mode: 0o600 });
  stage(stamped.map((line) => line.key), statSync(inbox).size);
} finally {
  rmdirSync(lock);
}

if (env.FAKE_SMINOS_RESULTS) process.stdout.write(readFileSync(env.FAKE_SMINOS_RESULTS, 'utf8'));
else process.stdout.write(`${JSON.stringify({ session, results: stamped.map((line) => ({ key: line.key, state: 'queued' })) })}\n`);

function stage(keys, inboxLength) {
  const next = join(sheet, `${session}.next`);
  if (!existsSync(next)) return;
  const fixtureKeys = JSON.parse(readFileSync(join(next, 'keys.json'), 'utf8'));
  const takenPath = join(next, 'taken.json');
  const taken = existsSync(takenPath) ? JSON.parse(readFileSync(takenPath, 'utf8')) : [];
  for (const key of keys) if (taken.length < fixtureKeys.length) taken.push(key);
  writeFileSync(takenPath, JSON.stringify(taken));
  if (taken.length < fixtureKeys.length) return;
  const placed = new Map(fixtureKeys.map((key, i) => [key, taken[i]]));
  const swap = (value) => {
    if (typeof value === 'string') return placed.get(value) ?? value;
    if (Array.isArray(value)) return value.map(swap);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [placed.get(key) ?? key, swap(inner)]));
  };
  const state = swap(JSON.parse(readFileSync(join(next, 'state.json'), 'utf8')));
  state.inbox = { ...state.inbox, offset: inboxLength };
  const temporary = join(record, `.state.${process.pid}.json`);
  writeFileSync(temporary, `${JSON.stringify(state, null, 1)}\n`, { mode: 0o600 });
  renameSync(temporary, join(record, 'state.json'));
  rmSync(next, { recursive: true });
}
