// `mawsd endpoint <command>` (Interfaces §F; O2 M6 delegates them through `daemon.endpoint`, with `enroll` and `keys`
// as `mawsd`'s own aliases):
//
//   enroll [--name N] [--replace] [--wait [s]] [--json]   the code is the request's `secret` (stdin), never an argument
//   keys [--json] | status [--json]
//   revoke <file|->        a signed org state (or {states, transitions}) delivered by hand, adopted as from the hub
//   grant <file|->         a signed grant, kept by the ledger's rule (grants.ts)
//   policy [--read-only on|off] [--ceiling MODE|settings] [--json]
//   legacy retire          deletes the DX1 org key (O14's final brief)
//   attest-history [--former NAME]… [--project ID] [--check] [--json]
//                          signs the machine's phase-1 history, or checks what the hub keeps of it (history.ts, O14 M4)
//
// `-` reads the file's content from the request's `secret`, as `mawsd`'s client sends stdin. Exit codes are O2's: 0
// done, 1 failed, 2 not available here, 3 not running, 4 enrolled with the hub but not yet listed in the org state.
import { readFileSync } from 'node:fs';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { keyId, stateHash, type SignedOrgState } from 'org-protocol';
import { EnrollError, enrollAttended } from './enroll';
import { attestHistory, checkHistory, historyNames, type Attested, type Checked } from './history';
import type { Endpoint } from './endpoint';
import { acceptGrant } from './grants';
import { describePolicy, isCeiling } from './policy';

export const EXIT = { done: 0, failed: 1, notHere: 2, notRunning: 3, notListed: 4 } as const;

type Out = { code: number; out: string };

const USAGE = `usage: mawsd endpoint enroll [--name N] [--replace] [--wait [s]] [--json] | keys [--json] | status [--json]
                     | revoke <file|-> | grant <file|-> | policy [--read-only on|off] [--ceiling MODE|settings] | legacy retire
                     | attest-history [--former NAME]… [--project ID] [--check] [--json]`;
/** `--wait` with no number waits this long (O2 M6). */
const DEFAULT_WAIT_S = 300;

export async function runCli(endpoint: Endpoint, command: string, args: readonly string[], secret?: string): Promise<Out> {
  if (endpoint.parts === null) return { code: EXIT.notRunning, out: 'the endpoint has not started' };
  try {
    switch (command) {
      case 'enroll':
        return await enroll(endpoint, args, secret);
      case 'keys':
        return await keys(endpoint, args);
      case 'status':
        return status(endpoint, args);
      case 'revoke':
        return await revoke(endpoint, args, secret);
      case 'grant':
        return await grant(endpoint, args, secret);
      case 'policy':
        return policy(endpoint, args);
      case 'legacy':
        return legacy(endpoint, args);
      case 'attest-history':
        return await attestHistoryCommand(endpoint, args);
      default:
        return { code: EXIT.failed, out: USAGE };
    }
  } catch (error) {
    if (error instanceof EnrollError || error instanceof UsageError) return { code: EXIT.failed, out: error.message };
    return { code: EXIT.failed, out: `${command} failed: ${(error as Error).message}` };
  }
}

class UsageError extends Error {}

function parse<const T extends ParseArgsOptionsConfig>(args: readonly string[], options: T, positionals = 0) {
  try {
    const parsed = parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
    if (parsed.positionals.length > positionals) throw new Error(`unexpected argument ${parsed.positionals[positionals]}`);
    return parsed;
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${USAGE}`);
  }
}

async function enroll(endpoint: Endpoint, args: readonly string[], secret: string | undefined): Promise<Out> {
  // `--wait` takes an optional number of seconds.
  const normalized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--wait') normalized.push(args[i]);
    else if (/^\d+$/.test(args[i + 1] ?? '')) normalized.push(`--wait=${args[++i]}`);
    else normalized.push(`--wait=${DEFAULT_WAIT_S}`);
  }
  const { values } = parse(normalized, { name: { type: 'string' }, replace: { type: 'boolean' }, wait: { type: 'string' }, json: { type: 'boolean' } });
  if (secret === undefined || secret.trim() === '') return { code: EXIT.failed, out: 'the enrollment code is read from stdin (or the hidden prompt), never from an argument' };
  const waitS = values.wait === undefined ? 0 : Number(values.wait);
  if (!Number.isFinite(waitS) || waitS < 0) throw new UsageError(`--wait takes a number of seconds, not ${values.wait}\n${USAGE}`);
  const waitMs = waitS * 1000;
  const { result, refused } = await enrollAttended(endpoint.enrollContext(), { code: secret, name: values.name, replace: values.replace === true, waitMs });
  const code = result.state === 'org-listed' ? EXIT.done : EXIT.notListed;
  if (values.json) return { code, out: JSON.stringify({ enrollment: result.state, name: result.name, org: result.org, ref: result.ref, ...(refused === undefined ? {} : { refused }) }) };
  const out =
    result.state === 'org-listed'
      ? `enrolled: ${result.name} in ${result.org}, listed in the org state`
      : `enrolled with the hub: ${result.name} in ${result.org}, not yet listed in the org state${refused === undefined ? '' : ` (the last state read was refused: ${refused})`}; a member's app lists it, and \`mawsd endpoint keys\` shows when`;
  return { code, out };
}

async function keys(endpoint: Endpoint, args: readonly string[]): Promise<Out> {
  const { values } = parse(args, { json: { type: 'boolean' } });
  const { state, services } = endpoint.parts!;
  const enrollment = state.enrolled ? state.enrollment : null;
  const key = endpoint.key;
  const view = {
    enrollment: enrollment?.state ?? 'none',
    ...(enrollment === null ? {} : { name: enrollment.name, org: enrollment.org }),
    ref: services.machine.ref,
    ...(key === null || enrollment === null ? {} : { keyId: await keyId(key.pub), heldKeys: state.ledger?.heldKeys.length ?? 0 }),
    ...(state.refusing === null ? {} : { refusing: state.refusing }),
  };
  if (values.json) return { code: EXIT.done, out: JSON.stringify(view) };
  const lines = [`enrollment: ${view.enrollment}`, ...(enrollment === null ? [] : [`machine: ${enrollment.name} in ${enrollment.org}`]), `ref: ${view.ref}`];
  if ('keyId' in view) lines.push(`machine key: ${view.keyId} (${view.heldKeys} held over its enrollments)`);
  if (state.refusing !== null) lines.push(`refusing its state: ${state.refusing} (the log names the path)`);
  return { code: EXIT.done, out: lines.join('\n') };
}

function status(endpoint: Endpoint, args: readonly string[]): Out {
  const { values } = parse(args, { json: { type: 'boolean' } });
  const s = endpoint.status();
  if (values.json) return { code: EXIT.done, out: JSON.stringify(s) };
  const lines = [`enrollment: ${s.enrollment}${s.name === undefined ? '' : ` (${s.name} in ${s.org})`}`];
  if (s.stateVersion !== undefined) lines.push(`org state: version ${s.stateVersion}`);
  lines.push(`hub: ${s.hub.connected ? 'connected' : 'not connected'}; channels: ${s.channels.relayed} relayed, ${s.channels.direct} direct; sminos: ${s.rl10.connected ? 'connected' : 'not connected'}`);
  if (s.refusing !== undefined) lines.push(`refusing: ${s.refusing}`);
  return { code: EXIT.done, out: lines.join('\n') };
}

/** The content of `<file|->`: a path read here, or `-` for the request's `secret`. */
function content(args: readonly string[], secret: string | undefined, what: string): unknown {
  const { positionals } = parse(args, {}, 1);
  const source = positionals[0];
  if (source === undefined) throw new UsageError(`${what}: give a file, or - for stdin\n${USAGE}`);
  const text = source === '-' ? secret : readFileSync(source, 'utf8');
  if (text === undefined) throw new UsageError(`${what}: nothing came on stdin`);
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${what}: not JSON`);
  }
}

async function revoke(endpoint: Endpoint, args: readonly string[], secret: string | undefined): Promise<Out> {
  const value = content(args, secret, 'revoke');
  const { state, org } = endpoint.parts!;
  if (!state.enrolled || !org.ready) return { code: EXIT.failed, out: 'not enrolled in an org: there is no state to apply it to' };
  const delivered = value as { states?: unknown; transitions?: unknown; state?: unknown };
  const states = Array.isArray(value) ? value : 'state' in delivered ? [value] : (delivered.states ?? []);
  const result = await org.adopt(states, delivered.transitions ?? []);
  if (result.adopted > 0) return { code: EXIT.done, out: `adopted: the org state is at version ${org.head().state.version}${result.rewound ? ' (a recovery rewind)' : ''}` };
  const head = org.head();
  const held = (states as SignedOrgState[]).find((s) => s?.state?.version === head.state.version);
  if (held !== undefined && (await stateHash(held.state)) === (await stateHash(head.state))) return { code: EXIT.done, out: `already held: the org state is at version ${head.state.version}` };
  return { code: EXIT.failed, out: `refused: ${result.refused ?? 'nothing newer than the head'}` };
}

async function grant(endpoint: Endpoint, args: readonly string[], secret: string | undefined): Promise<Out> {
  const value = content(args, secret, 'grant');
  const { state, org, services } = endpoint.parts!;
  const result = await acceptGrant(state, org, services.machine.ref, value, new Date(endpoint.deps.now()));
  if (!result.ok) return { code: EXIT.failed, out: `refused: ${result.reason}` };
  endpoint.channels.refreshCaps();
  const g = result.grant.body;
  return { code: EXIT.done, out: `kept: version ${g.version} for member ${g.member}, ${g.rights.length === 0 ? 'no rights' : g.rights.join(', ')}` };
}

function policy(endpoint: Endpoint, args: readonly string[]): Out {
  const { values } = parse(args, { 'read-only': { type: 'string' }, ceiling: { type: 'string' }, json: { type: 'boolean' } });
  const readOnly = values['read-only'];
  if (readOnly !== undefined && readOnly !== 'on' && readOnly !== 'off') throw new UsageError('--read-only is on or off');
  if (values.ceiling !== undefined && !isCeiling(values.ceiling)) throw new UsageError('the ceiling is one of plan, default, acceptEdits, auto, dontAsk, bypassPermissions, or settings for the machine\'s defaultMode');
  if (readOnly !== undefined || values.ceiling !== undefined) {
    if (endpoint.parts!.state.refusing !== null) return { code: EXIT.failed, out: `the endpoint's state is refused (${endpoint.parts!.state.refusing}): nothing is written` };
    endpoint.policy.set({ ...(readOnly === undefined ? {} : { read_only: readOnly === 'on' }), ...(values.ceiling === undefined || !isCeiling(values.ceiling) ? {} : { ceiling: values.ceiling }) });
  }
  const current = endpoint.policy.current();
  return { code: EXIT.done, out: values.json ? JSON.stringify(current) : describePolicy(current) };
}

function legacy(endpoint: Endpoint, args: readonly string[]): Out {
  const { positionals } = parse(args, {}, 1);
  if (positionals[0] !== 'retire') return { code: EXIT.failed, out: USAGE };
  const { state } = endpoint.parts!;
  if (!state.legacy) return { code: EXIT.done, out: 'no legacy org key is held' };
  state.removeLegacy();
  return { code: EXIT.done, out: 'the legacy org key is deleted: events go out v2-only from now on' };
}

/**
 * `attest-history`: the machine's DX1 writers under its current name and each `--former` one, attested (exit 0 when
 * every one is attested or was already, 1 when any is skipped or refused), or with `--check` judged against what the hub
 * keeps (exit 0 only when every one is `verified`). Attesting needs the legacy key, to check each event's code; the check
 * needs none. Both need the machine listed in the org state, whose key signs.
 */
async function attestHistoryCommand(endpoint: Endpoint, args: readonly string[]): Promise<Out> {
  const { values } = parse(args, { former: { type: 'string', multiple: true }, project: { type: 'string' }, check: { type: 'boolean' }, json: { type: 'boolean' } });
  const { state, org, services } = endpoint.parts!;
  const enrollment = state.enrolled ? state.enrollment : null;
  if (enrollment === null) return { code: EXIT.failed, out: 'not enrolled: there is no machine key to sign with' };
  if (enrollment.state !== 'org-listed' || endpoint.key === null || !org.ready) {
    return { code: EXIT.notListed, out: `${enrollment.name} is not listed in the org state yet: nothing its key signs would verify` };
  }
  const names = historyNames(enrollment.name, values.former ?? []);
  if (typeof names === 'string') throw new UsageError(`${names}\n${USAGE}`);
  const legacy = endpoint.rl10.legacy;
  if (!values.check && !legacy.held) return { code: EXIT.failed, out: 'no legacy org key is held: no event’s code can be checked, so nothing is attested (`--check` needs none)' };
  const ctx = {
    deps: endpoint.deps,
    hub: enrollment.hub,
    credentials: enrollment.credentials,
    org: enrollment.org,
    ref: services.machine.ref,
    key: endpoint.key,
    head: org.head().state,
    certificates: org.certificates(),
    verifiesCode: (project: string, event: object) => legacy.verifies(project, event),
  };
  if (values.check) {
    const checked = await checkHistory(ctx, names, values.project);
    const code = checked.every((c) => c.outcome === 'verified') ? EXIT.done : EXIT.failed;
    if (values.json) return { code, out: JSON.stringify({ names, writers: checked }) };
    return { code, out: [...checked.map(checkedLine), summary(checked, names)].join('\n') };
  }
  const attested = await attestHistory(ctx, names, values.project);
  const code = attested.every((a) => a.outcome === 'attested' || a.outcome === 'already') ? EXIT.done : EXIT.failed;
  if (values.json) return { code, out: JSON.stringify({ names, writers: attested }) };
  return { code, out: [...attested.map(attestedLine), summary(attested, names)].join('\n') };
}

function attestedLine(a: Attested): string {
  const at = `${a.project}/${a.writer}`;
  if (a.outcome === 'attested') return `attested ${at} through ${a.upTo}`;
  if (a.outcome === 'already') return `already attested ${at} through ${a.upTo}`;
  if (a.outcome === 'skipped') return `skipped ${at}: seq ${a.seq} ${a.reason}`;
  return `refused ${at}: ${a.refusal}`;
}

function checkedLine(c: Checked): string {
  const at = `${c.project}/${c.writer}`;
  if (c.outcome === 'verified') return `verified ${at} through ${c.upTo}`;
  if (c.outcome === 'mismatch') return `mismatch ${at}: ${c.reason}`;
  if (c.outcome === 'missing') return `missing ${at}: the hub serves its events short of seq ${c.upTo}`;
  return `uncovered ${at}: no attestation reaches seq ${c.upTo}`;
}

/** `n outcome, …` over the writers, and the names they were asked under. */
function summary(rows: ReadonlyArray<{ outcome: string }>, names: string[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  const said = [...counts].map(([outcome, n]) => `${n} ${outcome}`).join(', ');
  return `${rows.length === 0 ? 'no DX1 writer' : said} under ${names.join(', ')}`;
}
