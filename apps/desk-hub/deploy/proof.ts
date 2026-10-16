// What every proof command (probe, fake-check, redeploy-check, measure, frame-cost) holds to, since each enrolls
// machines and registers a project, and a project and its events outlive the machine's revocation:
// - it runs only in a throwaway org, named with `--test-org`, never the owner's (`config.json`'s), and only while the
//   deployment serves that org, checked before anything is enrolled or written;
// - it cleans up what it enrolled or minted, each step attempted whatever happened before, and fails when one fails.
import type { Person } from './hub';

export const TEST_ORG_OPTION = { 'test-org': { type: 'string' } } as const;

/** The throwaway org a proof command was told to run in, or null (with why, on stderr). */
export function testOrgArg(value: string | undefined, ownersOrg: string): string | null {
  if (!value) {
    console.error('--test-org <id> is required: the throwaway org the deployment serves now (deploy --org-id <id> first)');
    return null;
  }
  if (value === ownersOrg) {
    console.error(`--test-org ${value} is the owner's org (deploy/config.json): the proofs run only in a throwaway org`);
    return null;
  }
  return value;
}

/** Refuses unless the deployment serves `org` now: the check every proof makes before its first enrollment or write. */
export async function assertServesOrg(person: Person, org: string): Promise<void> {
  const served = (await person.json<{ org: { id: string } }>('/api/me')).org.id;
  if (served !== org) throw new Error(`the deployment serves the org ${served}, not the throwaway ${org}: refusing to enroll or write anything`);
}

/** `assertServesOrg` for a command: false, with why on stderr, where it would throw. */
export async function servesOrg(person: Person, org: string): Promise<boolean> {
  try {
    await assertServesOrg(person, org);
    return true;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Cleanup steps, registered as soon as there is something to undo and run last first, every one of them. */
export class Cleanup {
  private readonly steps: Array<{ what: string; run: () => Promise<void> }> = [];

  add(what: string, run: () => Promise<void>): void {
    this.steps.push({ what, run });
  }

  /** Runs every step, each whatever the others did; what failed, as `<what>: <why>`. */
  async run(): Promise<string[]> {
    const failures: string[] = [];
    for (const step of this.steps.splice(0).reverse()) {
      try {
        await step.run();
      } catch (error) {
        failures.push(`${step.what}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const failure of failures) console.error(`cleanup failed: ${failure}`);
    return failures;
  }
}

/** Revokes a machine, which deletes its service token; one the hub does not hold (never enrolled, or gone) counts as
 * revoked. Any other answer throws. */
export async function revoke(person: Person, name: string): Promise<void> {
  const response = await person.fetch(`/api/machines/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (response.status === 200 || response.status === 404) return;
  throw new Error(`revoking ${name}: ${response.status} ${(await response.text()).slice(0, 200)}`);
}
