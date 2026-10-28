// `mawsd endpoint <command>` (Interfaces §F; O2 M6 delegates them through `daemon.endpoint`, with `enroll` and `keys`
// as `mawsd`'s own aliases):
//
//   enroll [--name N] [--replace] [--wait [s]] [--json]   the code is the request's `secret` (stdin), never an argument
//   provision [--name N] [--wait [s]] [--json]   a `smns-provision-v2.` code, as `enroll` reads its code (O14 M1)
//   retire [--not-after ISO] [--json]   a delegated machine retires its certificate, frees its hub row, destroys its keys
//   unenroll [--json]      back to `enrollment: none` on this machine alone: RL10 unserved, the keys destroyed
//   keys [--json] | status [--json]
//   revoke <file|->        a signed org state (or {states, transitions}) delivered by hand, adopted as from the hub
//   grant <file|->         a signed grant, kept by the ledger's rule (grants.ts)
//   policy [--read-only on|off] [--ceiling MODE|settings] [--json]
//   legacy retire          deletes the DX1 org key (O14's final brief)
//
// `-` reads the file's content from the request's `secret`, as `mawsd`'s client sends stdin. Exit codes are O2's: 0
// done, 1 failed, 2 not available here, 3 not running, 4 enrolled with the hub but not yet listed in the org state.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { decodeProvisioningCodeV2, isIsoMillis, keyId, stateHash, type ProvisioningCodeV2, type SignedOrgState } from 'org-protocol';
import { EnrollError, enrollAttended } from './enroll';
import { defaultMachineName, provisionInto } from './provision';
import type { Endpoint } from './endpoint';
import { acceptGrant } from './grants';
import { describePolicy, isCeiling } from './policy';

export const EXIT = { done: 0, failed: 1, notHere: 2, notRunning: 3, notListed: 4 } as const;

type Out = { code: number; out: string };

const USAGE = `usage: mawsd endpoint enroll [--name N] [--replace] [--wait [s]] [--json] | provision [--name N] [--wait [s]] [--json]
                     | retire [--not-after ISO] [--json] | unenroll [--json] | keys [--json] | status [--json]
                     | revoke <file|-> | grant <file|-> | policy [--read-only on|off] [--ceiling MODE|settings] | legacy retire`;
/** `--wait` with no number waits this long (O2 M6). */
const DEFAULT_WAIT_S = 300;

export async function runCli(endpoint: Endpoint, command: string, args: readonly string[], secret?: string): Promise<Out> {
  if (endpoint.parts === null) return { code: EXIT.notRunning, out: 'the endpoint has not started' };
  try {
    switch (command) {
      case 'enroll':
        return await enroll(endpoint, args, secret);
      case 'provision':
        return await provision(endpoint, args, secret);
      case 'retire':
        return await retire(endpoint, args);
      case 'unenroll':
        return await unenroll(endpoint, args);
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

/** `--wait` with an optional number of seconds after it, as `--wait=<s>` (`DEFAULT_WAIT_S` when none follows). */
function normalizeWait(args: readonly string[]): string[] {
  const normalized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--wait') normalized.push(args[i]);
    else if (/^\d+$/.test(args[i + 1] ?? '')) normalized.push(`--wait=${args[++i]}`);
    else normalized.push(`--wait=${DEFAULT_WAIT_S}`);
  }
  return normalized;
}

/** `--wait`'s seconds in milliseconds, 0 when it is absent. */
function waitOf(wait: string | undefined, absent = 0): number {
  const waitS = wait === undefined ? absent : Number(wait);
  if (!Number.isFinite(waitS) || waitS < 0) throw new UsageError(`--wait takes a number of seconds, not ${wait}\n${USAGE}`);
  return waitS * 1000;
}

async function enroll(endpoint: Endpoint, args: readonly string[], secret: string | undefined): Promise<Out> {
  const { values } = parse(normalizeWait(args), { name: { type: 'string' }, replace: { type: 'boolean' }, wait: { type: 'string' }, json: { type: 'boolean' } });
  if (secret === undefined || secret.trim() === '') return { code: EXIT.failed, out: 'the enrollment code is read from stdin (or the hidden prompt), never from an argument' };
  const waitMs = waitOf(values.wait);
  const { result, refused } = await enrollAttended(endpoint.enrollContext(), { code: secret, name: values.name, replace: values.replace === true, waitMs });
  const code = result.state === 'org-listed' ? EXIT.done : EXIT.notListed;
  if (values.json) return { code, out: JSON.stringify({ enrollment: result.state, name: result.name, org: result.org, ref: result.ref, ...(refused === undefined ? {} : { refused }) }) };
  const out =
    result.state === 'org-listed'
      ? `enrolled: ${result.name} in ${result.org}, listed in the org state`
      : `enrolled with the hub: ${result.name} in ${result.org}, not yet listed in the org state${refused === undefined ? '' : ` (the last state read was refused: ${refused})`}; a member's app lists it, and \`mawsd endpoint keys\` shows when`;
  return { code, out };
}

/**
 * `provision` (O14 M1): the code from the request's secret, the name from `--name` or the host's; waits `--wait` (300 s
 * when absent) for the certificate to be live. Exit 0 when live, 4 while `hub-confirmed`, 1 on a refusal.
 */
async function provision(endpoint: Endpoint, args: readonly string[], secret: string | undefined): Promise<Out> {
  const { values } = parse(normalizeWait(args), { name: { type: 'string' }, wait: { type: 'string' }, json: { type: 'boolean' } });
  if (secret === undefined || secret.trim() === '') return { code: EXIT.failed, out: 'the provisioning code is read from stdin (or the hidden prompt), never from an argument' };
  const waitMs = waitOf(values.wait, DEFAULT_WAIT_S);
  let code: ProvisioningCodeV2;
  try {
    code = decodeProvisioningCodeV2(secret.trim());
  } catch (error) {
    throw new EnrollError(`not a provisioning code: ${(error as Error).message.replace(/^provisioning code: /, '')}`);
  }
  const { state } = endpoint.parts!;
  const name = values.name ?? state.provisioning?.redeemed.machine ?? (state.enrolled ? state.enrollment?.name : undefined) ?? defaultMachineName();
  const { result, refused } = await provisionInto(endpoint.enrollContext(), { ...code, name, waitMs });
  const exit = result.state === 'org-listed' ? EXIT.done : EXIT.notListed;
  if (values.json) return { code: exit, out: JSON.stringify({ enrollment: result.state, name: result.name, org: result.org, ref: result.ref, delegated: true, ...(refused === undefined ? {} : { refused }) }) };
  const out =
    result.state === 'org-listed'
      ? `provisioned: ${result.name} in ${result.org}, certified under the delegation ${code.delegation.id}`
      : `provisioned with the hub: ${result.name} in ${result.org}, its certificate not yet live${refused === undefined ? '' : ` (${refused})`}; \`provision\` again resumes it`;
  return { code: exit, out };
}

/** `retire` (O14 M1): a delegated machine's departure (retire.ts). */
async function retire(endpoint: Endpoint, args: readonly string[]): Promise<Out> {
  const { values } = parse(args, { 'not-after': { type: 'string' }, json: { type: 'boolean' } });
  const notAfter = values['not-after'];
  if (notAfter !== undefined && !isIsoMillis(notAfter)) throw new UsageError(`--not-after takes an ISO time with milliseconds in UTC (2026-10-28T12:00:00.000Z), not ${notAfter}\n${USAGE}`);
  const outcome = await endpoint.retire(notAfter === undefined ? {} : { notAfter });
  if (values.json) return { code: EXIT.done, out: JSON.stringify(outcome) };
  switch (outcome.kind) {
    case 'nothing':
      return { code: EXIT.done, out: 'nothing to retire: this machine holds no certificate and no credential' };
    case 'retired':
      return { code: EXIT.done, out: `retired: ${outcome.name} (certificate ${outcome.keyId} not after ${outcome.notAfter}); the hub row is gone; the keys are destroyed` };
    case 'uncertified':
      return { code: EXIT.done, out: `retired: ${outcome.name}, whose certificate the hub never held (${outcome.reason}); the hub row is gone; the keys are destroyed` };
    case 'orphaned':
      return { code: EXIT.done, out: `retired: ${outcome.name} here; the hub no longer took its credential, so its row and any certificate are an admin's to drop (\`machine drop ${outcome.name}\`); the keys are destroyed` };
  }
}

/** `unenroll` (O14 M1): local, talks to no hub, refuses no enrollment state. */
async function unenroll(endpoint: Endpoint, args: readonly string[]): Promise<Out> {
  const { values } = parse(args, { json: { type: 'boolean' } });
  const { aside, keyIds } = await endpoint.unenroll();
  const kept = basename(aside);
  if (values.json) return { code: EXIT.done, out: JSON.stringify({ enrollment: 'none', destroyed: keyIds, aside: kept }) };
  return { code: EXIT.done, out: `enrollment: none; ${keyIds.length} private key(s) destroyed (their ids kept in ${kept}/keys.json), the rest of the state moved to ${kept}/` };
}

async function keys(endpoint: Endpoint, args: readonly string[]): Promise<Out> {
  const { values } = parse(args, { json: { type: 'boolean' } });
  const { state, services } = endpoint.parts!;
  const enrollment = state.enrolled ? state.enrollment : null;
  // A redemption whose set is not yet whole is the hub's already (O14 M1), as `status` says it.
  const pending = enrollment === null ? (state.provisioning?.redeemed ?? null) : null;
  const named = enrollment ?? (pending === null ? null : { name: pending.machine, org: pending.org });
  const key = endpoint.key;
  const view = {
    enrollment: enrollment?.state ?? (pending === null ? 'none' : 'hub-confirmed'),
    ...(named === null ? {} : { name: named.name, org: named.org }),
    ref: services.machine.ref,
    delegated: state.delegation !== null,
    ...(key === null || enrollment === null ? {} : { keyId: await keyId(key.pub), heldKeys: state.ledger?.heldKeys.length ?? 0 }),
    ...(state.refusing === null ? {} : { refusing: state.refusing }),
  };
  if (values.json) return { code: EXIT.done, out: JSON.stringify(view) };
  const lines = [`enrollment: ${view.enrollment}`, ...(named === null ? [] : [`machine: ${named.name} in ${named.org}`]), `ref: ${view.ref}`];
  if ('keyId' in view) lines.push(`machine key: ${view.keyId} (${view.heldKeys} held over its enrollments)`);
  if (view.delegated) lines.push(`delegated: under the delegation ${state.delegation?.id}`);
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
