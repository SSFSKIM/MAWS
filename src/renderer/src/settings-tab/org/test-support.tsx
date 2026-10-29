// The Org page's suites' harness (P5 O8 M4a; the split's "Their tests split with them"): a fake `window.maws` standing for
// main's `org.*`, the page mounted through its shell, and the fixtures every group's suite reads. Each suite freezes Date
// itself (`vi.hoisted` is per file), so the fixtures' ages below are read against that clock.
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import type { CommandName, PreloadBridge } from '@shared/ipc/schema';
import { OrgStatusSchema, type DiscardResult, type OrgAttempt, type OrgSignerStatus, type OrgStatus, type OrgView, type PreviewResult, type SignResult } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { validateCommandInput } from '@shared/ipc/validate';
import { useMachines } from '../../stores/machines';
import { useNotices } from '../../stores/notices';
import { TEST_MACHINE } from '../../../../../test/support/machine';
import { OrgSection } from './OrgSection';

export const CODE = 'mawspair-7Hq2xVb9-secret';
export const DEVICE = 'k9F3aQ2mZt7bW1xYc0dE';
export const DAY = 86_400_000;
export const ME = '0123456789abcdef0123456789abcdef';

export type Registered = Extract<OrgStatus, { state: 'registered' }>;
export const REGISTERED: Registered = {
  state: 'registered',
  org: 'org-1f2e',
  hub: 'https://hub.example.com',
  member: { id: ME, email: 'owner@example.com' },
  device: DEVICE,
  session: 'signed-in',
  hubAccess: 'connected',
  head: { version: 12, issued: new Date(Date.now() - 3 * DAY).toISOString() },
  problem: null,
  signer: null,
  pairing: null,
};

export type Signer = NonNullable<OrgSignerStatus>;
export const FINGERPRINT = '65u7k-rscy7';
export const SIGNER: Signer = {
  root: false,
  maySign: false,
  fingerprint: FINGERPRINT,
  stepUpKid: 'stepUpKid0001',
  due: false,
  ageDays: 3,
  pending: null,
  offer: null,
  owing: [],
  abandoned: [],
  rekey: null,
  rekeying: null,
  oldDevice: null,
};
export const signing = (signer: Partial<Signer>, rest: Partial<Registered> = {}): OrgStatus => ({ ...REGISTERED, ...rest, signer: { ...SIGNER, ...signer } });
export const ROOT: Partial<Signer> = { root: true, maySign: true };

// The org the page's groups draw: you (this Mac a root, and a second Mac of yours), Ana an admin with one Mac, Ben a
// member with a browser, Cat a member with no device yet; two machines, one yours and one the org's; and a root kid the
// head lists no device for.
export const ANA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const BEN = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const CAT = 'cccccccccccccccccccccccccccccccc';
export const MY_OTHER_MAC = 'Myd2SecondMacZ0000001';
export const ANA_MAC = 'AnaMac7Hq2xVb9000001';
export const BEN_WEB = 'BenWebQ9xYc0dE000001';
export const MINI = 'MawsMiniRef000000001' as MachineRef;
export const VM = 'DevcloudVmRef0000002' as MachineRef;
export const VIEW: OrgView = {
  version: 12,
  issued: new Date(Date.now() - 3 * DAY).toISOString(),
  maySign: true,
  recoveryKid: 'recoveryKid00001',
  members: [
    {
      id: ME,
      email: 'owner@example.com',
      name: 'Owner',
      role: 'admin',
      you: true,
      devices: [
        { id: DEVICE, class: 'native-mac', keyStorage: 'software', root: true, thisMac: true, fingerprint: FINGERPRINT },
        { id: MY_OTHER_MAC, class: 'native-mac', keyStorage: 'software', root: false, thisMac: false, fingerprint: 'm2fp0-00002' },
      ],
    },
    { id: ANA, email: 'ana@example.com', name: 'Ana', role: 'admin', you: false, devices: [{ id: ANA_MAC, class: 'native-mac', keyStorage: 'software', root: false, thisMac: false, fingerprint: 'anafp-00001' }] },
    { id: BEN, email: 'ben@example.com', name: 'Ben', role: 'member', you: false, devices: [{ id: BEN_WEB, class: 'web-cards', keyStorage: 'passkey', root: false, thisMac: false, fingerprint: 'benfp-00001' }] },
    { id: CAT, email: 'cat@example.com', name: 'Cat', role: 'member', you: false, devices: [] },
  ],
  machines: [
    { name: 'mini', ref: MINI, owners: [ME, ANA] },
    { name: 'build-vm', ref: VM, owners: 'org' },
  ],
  roots: [
    { kid: 'stepUpKid0001', member: ME, device: DEVICE },
    { kid: 'orphanKid0002', unlisted: true },
  ],
};
export const viewWith = (patch: Partial<OrgView>): OrgView => ({ ...VIEW, ...patch });

type Answer = () => unknown;
let calls: { name: string; input: unknown }[] = [];
let listeners = new Set<(payload: unknown) => void>();
let current: OrgStatus = { state: 'none' };

/** `org.view` as main reads it for `status`: VIEW, its `maySign` the signer's (a root, signed in, able to sign). */
export const viewOf = (status: OrgStatus): OrgView | null => (status.state === 'registered' ? { ...VIEW, maySign: status.session === 'signed-in' && status.signer?.maySign === true } : null);

/** The page as main draws it: `org.status` answers `status`, and each command its default unless `answers` names it. */
export function renderSection(status: OrgStatus, answers: Partial<Record<CommandName, Answer>> = {}, strict = false) {
  calls = [];
  listeners = new Set();
  current = status;
  const answer: Partial<Record<CommandName, Answer>> = {
    'org.status': () => status,
    'org.view': () => viewOf(current),
    'org.register': () => ({ ok: true }) satisfies OrgAttempt,
    'org.signIn': () => ({ ok: true }) satisfies OrgAttempt,
    'org.reanchor': () => ({ ok: true }) satisfies OrgAttempt,
    'org.cancel': () => undefined,
    'org.signOut': () => undefined,
    'org.resign': () => ({ ok: true, version: 13 }) satisfies SignResult,
    'org.revokeSuperseded': () => ({ ok: true, version: 13 }) satisfies SignResult,
    'org.rekey': () => ({ ok: true }) satisfies OrgAttempt,
    'org.discardPending': () => ({ ok: true, unsent: false, hubVersion: 12 }) satisfies DiscardResult,
    'org.resetSigning': () => undefined,
    'org.preview': () => ({ ok: false, reason: 'invalid', findings: [] }) satisfies PreviewResult,
    'org.change': () => ({ ok: true, version: 13 }) satisfies SignResult,
    'org.pair.cancel': () => undefined,
    ...answers,
  };
  window.maws = {
    invoke: vi.fn(async (name: CommandName, input: unknown) => {
      calls.push({ name, input });
      const checked = validateCommandInput(name, input);
      if (!checked.ok) return checked;
      const reply = answer[name];
      return reply ? { ok: true, value: await reply() } : { ok: false, error: { code: 'internal', message: `no answer for ${name}` } };
    }),
    on: (name: string, listener: (payload: unknown) => void) => {
      if (name !== 'org.changed') return () => {};
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    pathForFile: () => '',
    localMachine: TEST_MACHINE,
  } as unknown as PreloadBridge;
  return render(strict ? <StrictMode><OrgSection /></StrictMode> : <OrgSection />);
}

/** Main's `org.changed`, the whole status. */
export const emit = (next: OrgStatus) =>
  act(() => {
    current = next;
    listeners.forEach((listener) => listener(OrgStatusSchema.parse(next)));
  });
/** The inputs each call of `name` carried, in order. */
export const sent = (name: CommandName) => calls.filter((c) => c.name === name).map((c) => c.input);
/** A `label · value` row by its label. */
export const row = (label: string) => screen.getByRole('group', { name: label });
/** The same, once the status has been read. */
export const found = (label: string) => screen.findByRole('group', { name: label });
/** One of the page's four groups, once drawn. */
export const group = async (name: 'you' | 'people' | 'machines' | 'org') => {
  await screen.findByRole('heading', { level: 4, name: { you: 'You', people: 'People', machines: 'Machines', org: 'Org' }[name] });
  return document.querySelector<HTMLElement>(`[data-org-group="${name}"]`)!;
};

export function resetHarness() {
  cleanup();
  useNotices.setState({ notices: [] });
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  delete (window as { maws?: PreloadBridge }).maws;
}
