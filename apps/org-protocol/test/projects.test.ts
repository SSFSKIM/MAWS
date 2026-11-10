// The projects record and the org's projects assembled from records (the project registry, M1; Interfaces §A of
// docs/doperpowers/plans/2026-11-10-project-registry.md): every record vector's verdict, the count and byte bounds met
// exactly (the vectors exceed them; meeting them there would double the file), the machine project names a
// certificate-only VM is among, and `assembleProjects`' grouping, exclusions and names.
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.ts';
import { importSigningKey } from '../src/keys.ts';
import { assembleProjects, directoryMachineNames, directoryMachines, machineProjectNames } from '../src/projects.ts';
import { NO_CERTIFICATES, signRecord, verifyMachineCert, verifyProjectsRecord } from '../src/records.ts';
import { isProjectsRecord, PROJECTS_RECORD_BOUNDS } from '../src/shapes.ts';
import { SIGNING_DOMAINS, type Certificates, type OrgState, type ProjectLocation, type ProjectsRecord, type Signed, type SignedOrgState } from '../src/types.ts';
import { ORG, REF_MINI, REF_VM1, REF_VM_BUILD, VECTOR_KEYS, VECTORS } from '../vectors/index.ts';

const NOW = new Date('2026-10-28T00:00:00.000Z');
const fixture = <T>(name: string) => VECTORS.fixtures[name] as T;
const V2 = fixture<SignedOrgState>('v2').state;
const VM1_CERTS: Certificates = { certs: [fixture<Certificates['certs'][number]>('cert vm-1')], retirements: [] };
/** vm-1's certificate reissued under its name to another ref and key, later, signed by its delegation's key. */
async function reissued(old: Certificates['certs'][number]): Promise<Certificates['certs'][number]> {
  const delegation = await importSigningKey(VECTOR_KEYS.delegation.jwk);
  const body = { ...old.body, machine: `${REF_VM1}-next`, pub: VECTOR_KEYS.vm1Next.pub, issued: '2026-10-27T12:00:00.000Z' };
  return signRecord(SIGNING_DOMAINS.machineCert, body, delegation.privateKey, delegation.pub);
}

/** A vector argument with its `{$state}` and `{$fixture}` references resolved, as the replay does. */
function resolve(arg: unknown): unknown {
  if (Array.isArray(arg)) return arg.map(resolve);
  if (typeof arg !== 'object' || arg === null) return arg;
  const ref = arg as Record<string, unknown>;
  const name = ref.$state ?? ref.$fixture;
  if (typeof name !== 'string' || Object.keys(ref).length !== 1) return Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, resolve(v)]));
  const value = VECTORS.fixtures[name];
  return '$state' in ref ? (value as SignedOrgState).state : value;
}

describe("the projects record's vectors", () => {
  const cases = VECTORS.cases.filter((c) => c.call === 'verifyProjectsRecord');

  it('verify, or are refused with the code each names', async () => {
    expect(cases.length).toBeGreaterThan(40);
    for (const c of cases) {
      const [state, record, certs, now] = c.args.map(resolve) as [OrgState, Signed<ProjectsRecord>, Certificates, string];
      expect(await verifyProjectsRecord(state, record, certs, new Date(now)), c.name).toEqual(c.expect);
    }
  });

  it('carry the cases §B lists', () => {
    const names = new Set(cases.map((c) => c.name));
    const expectations: Array<[string, string | true]> = [
      ['a projects record signed by its listed machine', true],
      ['a projects record signed by a certified VM', true],
      ['a projects record signed as an endpoint record', 'bad-signature'],
      ['a projects record with 1,001 locations', 'malformed'],
      ['a projects record with 1,001 known projects', 'malformed'],
      ['a projects record of 262,145 canonical bytes', 'malformed'],
      ['a location path of 4,097 bytes', 'malformed'],
      ['a pid of 65 characters', 'malformed'],
      ['a project id of 65 characters', 'malformed'],
      ['a key of 601 bytes', 'malformed'],
      ['a name of 129 characters', 'malformed'],
      ['a remote of 513 bytes', 'malformed'],
      ['two locations of one pid', 'malformed'],
      ['a location of a relative path', 'malformed'],
      ['a projects record of a VM whose certificate the state retired', 'not-listed'],
    ];
    for (const [name, verdict] of expectations) {
      expect(names, name).toContain(name);
      expect(cases.find((c) => c.name === name)?.expect, name).toEqual(verdict === true ? { ok: true } : { ok: false, code: verdict });
    }
  });
});

describe("the projects record's bounds, met exactly", () => {
  const base: ProjectsRecord = { org: ORG, machine: REF_MINI, revision: 1, issued: '2026-10-27T03:00:00.000Z', locations: [], known: [] };
  const plain = (i: number, path = `/f/${i}`): ProjectLocation => ({ pid: `p${i}`, id: `f${i}`, key: `folder:${i}`, name: `f${i}`, path, source: 'folder', stated: 'minted' });
  const signed = async (body: ProjectsRecord) => {
    const key = await importSigningKey(VECTOR_KEYS.mini.jwk);
    return signRecord(SIGNING_DOMAINS.projects, body, key.privateKey, key.pub);
  };

  it('takes 1,000 locations and 1,000 known projects', async () => {
    const body = { ...base, locations: Array.from({ length: 1_000 }, (_, i) => plain(i)), known: Array.from({ length: 1_000 }, (_, i) => ({ id: `k${i}`, name: `k${i}` })) };
    expect(await verifyProjectsRecord(V2, await signed(body), NO_CERTIFICATES, NOW)).toEqual({ ok: true });
  });

  it('takes a canonical form of 262,144 bytes and refuses one more', () => {
    const body: ProjectsRecord = { ...base };
    const size = () => new TextEncoder().encode(canonicalize(body)).length;
    const long = (i: number, length: number) => plain(i, `/${String(i).padStart(4, '0')}/${'d'.repeat(length - 6)}`);
    body.locations = [];
    while (size() <= PROJECTS_RECORD_BOUNDS.bytes) body.locations.push(long(body.locations.length, PROJECTS_RECORD_BOUNDS.path));
    const last = body.locations.length - 1;
    body.locations[last] = long(last, PROJECTS_RECORD_BOUNDS.path - (size() - PROJECTS_RECORD_BOUNDS.bytes));
    expect(size()).toBe(262_144);
    expect(isProjectsRecord(body)).toBe(true);
    body.locations[last] = long(last, body.locations[last].path.length + 1);
    expect(size()).toBe(262_145);
    expect(isProjectsRecord(body)).toBe(false);
  });
});

describe("the machine names: the directory's and the registry's", () => {
  it('name the enrolled machines and a VM that exists only by its certificate', () => {
    for (const names of [directoryMachineNames, machineProjectNames]) {
      expect(names(V2, NO_CERTIFICATES, NOW)).toEqual(['builder', 'mini']);
      expect(names(V2, VM1_CERTS, NOW)).toEqual(['builder', 'mini', 'vm-1']);
    }
  });

  it('leave out a certificate whose delegation is gone, expired or revoked', () => {
    const revoked = structuredClone(V2);
    revoked.revoked.push({ keyId: 'AAAAAAAAAAAAAAAAAAAAAA', holder: { delegation: V2.delegations[0].id, prefix: V2.delegations[0].prefix } });
    for (const names of [directoryMachineNames, machineProjectNames]) {
      expect(names(fixture<SignedOrgState>('v2 without the delegation').state, VM1_CERTS, NOW)).toEqual(['builder', 'mini']);
      expect(names(V2, VM1_CERTS, new Date('2026-12-01T00:00:00.000Z'))).toEqual(['builder', 'mini']);
      expect(names(revoked, VM1_CERTS, NOW)).toEqual(['builder', 'mini']);
    }
  });

  // the project registry's M12 (review 1's finding 2): `maws` aims at a machine by its name, and acts on it by its ref
  it('are the machines with their refs, a VM that exists only by its certificate among them, its gone delegation not', async () => {
    const certified = VM1_CERTS.certs[0]!.body as { machine: string; name: string };
    const enrolled = V2.machines.map((m) => ({ ref: m.ref, name: m.name })).sort((a, b) => a.name.localeCompare(b.name)); // by name
    expect(await directoryMachines(V2, NO_CERTIFICATES, NOW)).toEqual(enrolled);
    expect(await directoryMachines(V2, VM1_CERTS, NOW)).toEqual([...enrolled, { ref: certified.machine, name: 'vm-1' }]);
    expect(certified.machine).toBe(REF_VM1);
    expect((await directoryMachines(V2, VM1_CERTS, NOW)).map((m) => m.name)).toEqual(directoryMachineNames(V2, VM1_CERTS, NOW));
    expect(await directoryMachines(fixture<SignedOrgState>('v2 without the delegation').state, VM1_CERTS, NOW)).toEqual(enrolled);
    expect(await directoryMachines(V2, VM1_CERTS, new Date('2026-12-01T00:00:00.000Z'))).toEqual(enrolled);
  });

  // M12's re-review, finding 1: a VM retired and its name reissued is one machine, the replacement
  it('are one per name: a retired certificate none, the latest issued of one name the one, an enrolled machine before any', async () => {
    const old = VM1_CERTS.certs[0]!;
    const replacement = await reissued(old);
    const retired = structuredClone(V2);
    retired.retired.push({ keyId: 'AAAAAAAAAAAAAAAAAAAAAA', pub: old.body.pub, notAfter: '2026-10-27T11:00:00.000Z', holder: { machine: REF_VM1 } });
    const vms = async (state: OrgState, certs: Certificates['certs']) => (await directoryMachines(state, { certs, retirements: [] }, NOW)).filter((m) => m.name === 'vm-1');
    expect(await vms(retired, [old, replacement])).toEqual([{ ref: `${REF_VM1}-next`, name: 'vm-1' }]); // the retired ref, sorted first by ref, is no target
    expect(await vms(retired, [old]), 'a retired certificate alone').toEqual([]);
    expect(await vms(V2, [replacement, old]), 'two live certificates of one name: the latest issued').toEqual([{ ref: `${REF_VM1}-next`, name: 'vm-1' }]);
    const enrolledToo = structuredClone(V2);
    enrolledToo.machines.push({ ...enrolledToo.machines[0]!, name: 'VM-1', ref: 'mref-enrolled-vm1' });
    expect((await directoryMachines(enrolledToo, VM1_CERTS, NOW)).filter((m) => m.name.toLowerCase() === 'vm-1'), 'an enrolled machine before a certificate').toEqual([{ ref: 'mref-enrolled-vm1', name: 'VM-1' }]);
  });

  // branch review 1, P1: the hub's set is only shape-checked, so a certificate names a target only once it verifies
  it('take no target from a certificate `verifyMachineCert` refuses: a copy with its ref or its issued time altered', async () => {
    const genuine = VM1_CERTS.certs[0]!;
    const toMini = { ...genuine, body: { ...genuine.body, machine: REF_MINI, issued: '2026-10-27T12:00:00.000Z' } }; // another machine's ref
    const later = { ...genuine, body: { ...genuine.body, machine: `${REF_VM1}-forged`, issued: '2026-10-27T12:00:00.000Z' } }; // its delegation's shape
    for (const forged of [toMini, later]) {
      expect((await verifyMachineCert(V2, forged, NOW)).ok).toBe(false);
      const certs: Certificates = { certs: [genuine, forged], retirements: [] };
      expect((await directoryMachines(V2, certs, NOW)).find((m) => m.name === 'vm-1')).toEqual({ ref: REF_VM1, name: 'vm-1' });
      expect((await directoryMachines(V2, { certs: [forged], retirements: [] }, NOW)).map((m) => m.name), 'a forged certificate alone').not.toContain('vm-1');
    }
  });

  it('name what `directoryMachineNames` names, save a retired certificate’s name it lists', async () => {
    const old = VM1_CERTS.certs[0]!;
    const replacement = await reissued(old);
    const revoked = structuredClone(V2);
    revoked.revoked.push({ keyId: 'AAAAAAAAAAAAAAAAAAAAAA', holder: { delegation: V2.delegations[0].id, prefix: V2.delegations[0].prefix } });
    const inputs: Array<[OrgState, Certificates, Date]> = [
      [V2, NO_CERTIFICATES, NOW],
      [V2, VM1_CERTS, NOW],
      [V2, { certs: [old, replacement], retirements: [] }, NOW],
      [fixture<SignedOrgState>('v2 without the delegation').state, VM1_CERTS, NOW],
      [V2, VM1_CERTS, new Date('2026-12-01T00:00:00.000Z')],
      [revoked, VM1_CERTS, NOW],
      [fixture<SignedOrgState>('v3 renamed').state, NO_CERTIFICATES, NOW],
    ];
    for (const [state, certs, now] of inputs) expect((await directoryMachines(state, certs, now)).map((m) => m.name)).toEqual(directoryMachineNames(state, certs, now));
    // the one difference: the directory's names still list a certificate the head retired, which is no target
    const retired = structuredClone(V2);
    retired.retired.push({ keyId: 'AAAAAAAAAAAAAAAAAAAAAA', pub: old.body.pub, notAfter: '2026-10-27T11:00:00.000Z', holder: { machine: REF_VM1 } });
    expect(directoryMachineNames(retired, VM1_CERTS, NOW)).toContain('vm-1');
    expect((await directoryMachines(retired, VM1_CERTS, NOW)).map((m) => m.name)).not.toContain('vm-1');
  });

  it("take a renamed machine's old name into the registry's set alone, and no name of a ref the head no longer enrolls", () => {
    const renamed = fixture<SignedOrgState>('v3 renamed').state;
    expect(directoryMachineNames(renamed, NO_CERTIFICATES, NOW)).toEqual(['builder', 'studio']);
    expect(machineProjectNames(renamed, NO_CERTIFICATES, NOW)).toEqual(['builder', 'mini', 'studio']);
    const dropped = structuredClone(renamed);
    dropped.machines = dropped.machines.filter((m) => m.name !== 'studio');
    expect(machineProjectNames(dropped, NO_CERTIFICATES, NOW)).toEqual(['builder']);
  });
});

describe('assembleProjects', () => {
  /** A caller's map from machine names to their projects' ids; the endpoint and the app use `machineProjectId`. */
  const machineId = (name: string) => `machine-${name.toLowerCase()}`;
  const machines = new Set(machineProjectNames(V2, VM1_CERTS, NOW).map(machineId));
  const at = (pid: string, path: string, id: string, extra: Partial<ProjectLocation> = {}): ProjectLocation => ({
    pid,
    id,
    key: `folder:${path}`,
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    source: 'folder',
    ...extra,
  });
  const record = (machine: string, locations: ProjectLocation[], known: ProjectsRecord['known'] = [], revision = 1): ProjectsRecord => ({
    org: ORG,
    machine,
    revision,
    issued: '2026-10-27T03:00:00.000Z',
    locations,
    known,
  });
  const only = (records: ProjectsRecord[]) => {
    const projects = assembleProjects(records, machines);
    expect(projects).toHaveLength(1);
    return projects[0];
  };

  it('gives one project for two records naming one id, its locations by machine ref then path', () => {
    const p = only([
      record(REF_VM_BUILD, [at('b1', '/srv/scrape', 'scrape-id', { stated: 'linked' })]),
      record(REF_MINI, [at('m2', '/srv/zeta', 'scrape-id'), at('m1', '/srv/alpha', 'scrape-id', { stated: 'minted' })]),
      record(REF_VM1, [], [{ id: 'scrape-id', name: 'scrape' }]),
    ]);
    expect(p.id).toBe('scrape-id');
    expect(p.locations.map((l) => [l.machine, l.path])).toEqual([
      [REF_MINI, '/srv/alpha'],
      [REF_MINI, '/srv/zeta'],
      [REF_VM_BUILD, '/srv/scrape'],
    ]);
    expect(p.known).toEqual([REF_VM1]);
    expect(p).toMatchObject({ hub: true, renamable: true });
  });

  it("leaves out each machine's own project, a certificate-only VM's included, as a location or a known project", () => {
    const projects = assembleProjects(
      [
        record(REF_MINI, [at('m1', '/Users/a', machineId('mini')), at('m2', '/Users/a/work', 'work-id')]),
        record(REF_VM1, [at('v1', '/root', machineId('vm-1'))], [{ id: machineId('builder'), name: 'builder' }]),
      ],
      machines,
    );
    expect(projects.map((p) => p.id)).toEqual(['work-id']);
    // A session recorded under a renamed machine's old machine-project id registers nothing.
    const renamed = new Set(machineProjectNames(fixture<SignedOrgState>('v3 renamed').state, NO_CERTIFICATES, NOW).map(machineId));
    expect(assembleProjects([record(REF_MINI, [], [{ id: machineId('mini'), name: 'mini' }])], renamed)).toEqual([]);
    expect(assembleProjects([record(REF_VM1, [at('v1', '/root', machineId('vm-1'))])], new Set(machineProjectNames(V2, NO_CERTIFICATES, NOW).map(machineId)))).toHaveLength(1);
  });

  it("takes each machine's highest revision, and orders the projects by id", () => {
    const projects = assembleProjects(
      [record(REF_MINI, [at('m1', '/new', 'b-id')], [], 2), record(REF_MINI, [at('m1', '/old', 'c-id')], [], 1), record(REF_VM_BUILD, [at('b1', '/x', 'a-id')])],
      machines,
    );
    expect(projects.map((p) => [p.id, p.locations.map((l) => l.path)])).toEqual([
      ['a-id', ['/x']],
      ['b-id', ['/new']],
    ]);
  });

  it('marks a project off the hub when any location says so', () => {
    expect(only([record(REF_MINI, [at('m1', '/a', 'p', { source: 'smns', hub: false })]), record(REF_VM_BUILD, [at('b1', '/b', 'p')])]).hub).toBe(false);
  });

  describe("names a project by §A's order", () => {
    it('first, the name of the first location whose .smns decides, which is not renamable', () => {
      const p = only([
        record(REF_MINI, [at('m1', '/a', 'p', { name: 'renamed', nameRev: 4 })]),
        record(REF_VM_BUILD, [at('b1', '/b', 'p', { source: 'smns', name: 'by-file' }), at('b2', '/c', 'p', { source: 'smns', name: 'later' })]),
      ]);
      expect(p).toMatchObject({ name: 'by-file', renamable: false });
      // A file under a stored statement names nothing.
      const stated = only([record(REF_MINI, [at('m1', '/a', 'p', { source: 'smns', stated: 'linked', name: 'shadowed' }), at('m2', '/b', 'p', { name: 'chosen', nameRev: 1 })])]);
      expect(stated).toMatchObject({ name: 'chosen', renamable: true });
    });

    it('then the highest nameRev, a tie to the earlier location', () => {
      expect(only([record(REF_MINI, [at('m1', '/a', 'p', { name: 'old', nameRev: 1 })]), record(REF_VM_BUILD, [at('b1', '/b', 'p', { name: 'new', nameRev: 2 })])]).name).toBe('new');
      expect(only([record(REF_VM_BUILD, [at('b1', '/a', 'p', { name: 'later-ref', nameRev: 2 })]), record(REF_MINI, [at('m1', '/z', 'p', { name: 'earlier-ref', nameRev: 2 })])]).name).toBe('earlier-ref');
      expect(only([record(REF_MINI, [at('m1', '/a', 'p', { name: 'first', remote: 'github.com/example/x' }), at('m2', '/b', 'p', { name: 'renamed', nameRev: 1 })])]).name).toBe('renamed');
    });

    it('then the first location with a remote that is not linked', () => {
      const p = only([
        record(REF_MINI, [at('m1', '/a', 'p', { name: 'linked-clone', remote: 'github.com/example/other', stated: 'linked' }), at('m2', '/b', 'p', { name: 'plain' })]),
        record(REF_VM_BUILD, [at('b1', '/c', 'p', { name: 'alpha', remote: 'github.com/example/alpha', source: 'remote' })]),
      ]);
      expect(p.name).toBe('alpha');
    });

    it('then the first location, those not linked before those that are', () => {
      expect(only([record(REF_MINI, [at('m1', '/a', 'p', { name: 'linked', stated: 'linked' })]), record(REF_VM_BUILD, [at('b1', '/b', 'p', { name: 'minted', stated: 'minted' })])]).name).toBe('minted');
      expect(only([record(REF_MINI, [at('m1', '/a', 'p', { name: 'one', stated: 'linked' })]), record(REF_VM_BUILD, [at('b1', '/b', 'p', { name: 'two', stated: 'linked' })])]).name).toBe('one');
    });

    it('with no location, the known name from the lowest machine ref', () => {
      const p = only([record(REF_VM_BUILD, [], [{ id: 'p', name: 'from-builder' }]), record(REF_MINI, [], [{ id: 'p', name: 'from-mini' }])]);
      expect(p).toMatchObject({ name: 'from-mini', locations: [], known: [REF_MINI, REF_VM_BUILD] });
    });
  });
});
