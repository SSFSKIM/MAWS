// `daemon.*` (P5 O2 M5): the namespace's owners and lists, and daemon.status's local-only fields, whose redaction the
// endpoint applies for a remote caller without knowing O2's fields.
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { MAIN_ONLY_COMMANDS, NAMES } from '../names';
import { commands } from '../schema';
import { validateCommandOutput } from '../validate';
import { DaemonStatusSchema, isLocalOnly, remoteDaemonStatus, type DaemonStatus } from './daemon';

const status: DaemonStatus = {
  pid: 41022,
  startedAt: '2026-10-27T10:11:12.000Z',
  kind: 'private',
  build: { version: '0.0.0', commit: 'a1b2c3d4', builtAt: '2026-10-27T10:00:00.000Z', buildId: '0123456789abcdef', engineHostBuildId: 'fedcba9876543210' },
  machine: '9fQ2xK0bLw3mT1sVb7Yh_A' as DaemonStatus['machine'],
  profile: '/Users/someone/Library/Application Support/MAWS',
  platform: 'darwin',
  role: 'laptop',
  hosts: {
    'engine-host': { state: 'ready', pid: 41030, build: '5e6f7a8b9c0d1e2f', liveSessions: 0 },
    'pty-host': { state: 'parked', pid: null, build: null, liveSessions: null },
  },
  clients: { engineHost: false, ptyHost: false, machine: 1 },
  idleExitAt: null,
  logPath: '/Users/someone/Library/Application Support/MAWS/mawsd/mawsd.log',
  endpoint: { present: false, detail: null },
};

// Every object schema under DaemonStatusSchema, with its path, so the checks below reach nested fields too.
function fieldsOf(schema: z.ZodType, path: string[] = []): { path: string; name: string; schema: z.ZodType }[] {
  if (!(schema instanceof z.ZodObject)) return [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).flatMap(([name, field]) => {
    const unwrapped = field instanceof z.ZodOptional || field instanceof z.ZodNullable ? (field.unwrap() as z.ZodType) : field;
    return [{ path: [...path, name].join('.'), name, schema: field }, ...fieldsOf(unwrapped, [...path, name])];
  });
}

describe('the daemon namespace', () => {
  it('is machine-owned and main-only, bridging nothing', () => {
    const daemon = Object.entries(commands).filter(([name]) => name.startsWith('daemon.'));
    expect(Object.fromEntries(daemon.map(([name, spec]) => [name, spec.owner]))).toEqual({ 'daemon.status': 'machine', 'daemon.restart': 'machine', 'daemon.endpoint': 'machine', 'daemon.e2eSeam': 'machine', 'daemon.e2eRender': 'machine' /* P5 O5 M4 */ });
    expect(NAMES.daemon.commands).toEqual([]);
    expect(MAIN_ONLY_COMMANDS).toEqual(expect.arrayContaining(['daemon.status', 'daemon.restart', 'daemon.endpoint', 'daemon.e2eSeam', 'daemon.e2eRender']));
  });

  it('carries the enrollment secret only as an optional field of daemon.endpoint, never in args', () => {
    const input = commands['daemon.endpoint'].input;
    expect(input.safeParse({ command: 'enroll', args: ['--name', 'mini'], secret: 'code' }).success).toBe(true);
    expect(input.safeParse({ command: 'keys', args: [] }).success).toBe(true);
    expect(input.safeParse({ command: 'keys', args: [], extra: 1 }).success).toBe(false);
  });
});

describe('daemon.status for a remote caller', () => {
  it('drops every field the schema marks local-only, and nothing else', () => {
    const remote = remoteDaemonStatus(status);
    expect(remote).not.toHaveProperty('profile');
    expect(remote).not.toHaveProperty('logPath');
    const rest: Partial<DaemonStatus> = { ...status };
    delete rest.profile;
    delete rest.logPath;
    expect(remote).toEqual(rest);
  });

  it('validates as the registry output both whole and redacted', () => {
    expect(validateCommandOutput('daemon.status', status).ok).toBe(true);
    expect(validateCommandOutput('daemon.status', remoteDaemonStatus(status)).ok).toBe(true);
    expect(DaemonStatusSchema.safeParse(remoteDaemonStatus(status)).success).toBe(true);
  });

  it('marks every field that holds a path, and every marked field is optional', () => {
    const fields = fieldsOf(DaemonStatusSchema);
    const holdsPath = (name: string) => /Path$/.test(name) || name === 'profile' || name === 'dir';
    for (const field of fields.filter(({ name }) => holdsPath(name))) expect(isLocalOnly(field.schema), `${field.path} holds a path and is not marked local-only`).toBe(true);
    for (const field of fields.filter(({ schema }) => isLocalOnly(schema))) expect(field.schema instanceof z.ZodOptional, `${field.path} is marked local-only and is not optional`).toBe(true);
    expect(fields.filter(({ schema }) => isLocalOnly(schema)).map(({ path }) => path).sort()).toEqual(['logPath', 'profile']);
  });

  it('would catch a path field added without the mark', () => {
    const grown = DaemonStatusSchema.extend({ socketPath: z.string() });
    const unmarked = fieldsOf(grown).filter(({ name, schema }) => /Path$/.test(name) && !isLocalOnly(schema));
    expect(unmarked.map(({ path }) => path)).toEqual(['socketPath']);
  });
});
