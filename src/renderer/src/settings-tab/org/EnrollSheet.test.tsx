// P5 O8 M4b: the enrollment sheet (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "Enroll a machine" and
// *The enrollment*): a name, or "Re-enroll <machine>" from its row; the code shown once, here only, with Copy and the line
// the machine runs; the wait, with the code's end; then the machine's name, ref and key id to compare; then the approval
// naming `{generation, digest}`. Every start refusal and every end has its own line; Cancel is always there.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ENROLL_PROBLEMS, ENROLL_REFUSALS, type EnrollStartResult, type OrgEnrollingStatus, type SignResult } from '@shared/ipc/schema/org';
import { MINI, ROOT, emit, found, group, renderSection, resetHarness, row, sent, signing, viewWith } from './test-support';

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

const CODE = 'mawsenroll2.eyJodWIiOiJodHRwczovL2h1YiJ9-the-secret-k-within';
const EXPIRES = '2026-10-28T13:00:00.000Z';
const CANDIDATE = { name: 'gpu-box', ref: 'GpuBoxRef00000000011', keyId: 'gpuBoxKeyId0011', digest: 'candidateDigest0011' };
const enrolling = (patch: Partial<NonNullable<OrgEnrollingStatus>> = {}): OrgEnrollingStatus => ({ generation: 1, name: 'gpu-box', replace: null, expires: EXPIRES, candidate: null, problem: null, ...patch });
const started: EnrollStartResult = { ok: true, code: CODE, expires: EXPIRES };
const DURING = 'The enrollment ended while Touch ID was open. Nothing was signed.';
const BEFORE = 'The enrollment ended, or its key changed, before Touch ID. Nothing was signed.';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function openEnroll() {
  await group('machines');
  fireEvent.click(await within(row('Enroll a machine')).findByRole('button', { name: 'Enroll a machine…' }));
  return screen.findByRole('dialog', { name: 'Enroll a machine' });
}
const makeCode = (sheet: HTMLElement, name: string) => {
  fireEvent.change(within(sheet).getByRole('textbox', { name: 'Name' }), { target: { value: `  ${name} ` } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
};

describe('Settings › Org: the enrollment sheet (M4b)', () => {
  it('a name, the code once with Copy and what the machine runs, the wait, then the name, ref and key id to compare; Approve names that candidate', async () => {
    const copied = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: copied }, configurable: true });
    const log = vi.spyOn(console, 'log');
    renderSection(signing(ROOT), { 'org.enroll.start': () => started, 'org.enroll.approve': () => ({ ok: true, version: 13 }) satisfies SignResult });
    const sheet = await openEnroll();
    expect((within(sheet).getByRole('button', { name: 'Make a code' }) as HTMLButtonElement).disabled).toBe(true); // a name first
    makeCode(sheet, 'gpu-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toEqual([{ name: 'gpu-box' }]));
    emit(signing(ROOT, { enrolling: enrolling() }));

    // the code, once, in the sheet alone, with Copy; the command, its hidden prompt, --replace; the code's end
    const code = await within(sheet).findByText(CODE);
    expect(code.className).toContain('font-mono');
    expect(screen.getAllByText(CODE)).toHaveLength(1);
    expect(within(sheet).getByText('mawsd enroll').className).toContain('font-mono');
    expect(within(sheet).getByText(/paste the code at its prompt, which hides it\. Never pass the code as an argument\. Add --replace while the machine is still enrolled\./)).toBeTruthy();
    expect(within(sheet).getByText(/^Shown once, here only\. It works until /)).toBeTruthy();
    expect(within(sheet).getByText('Waiting for gpu-box to post its key…')).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Approve…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copy' }));
    await vi.waitFor(() => expect(copied).toHaveBeenCalledWith(CODE));
    expect(await within(sheet).findByRole('button', { name: 'Copied' })).toBeTruthy();

    // the machine posted its key: what to compare, and the code gone for good
    emit(signing(ROOT, { enrolling: enrolling({ candidate: CANDIDATE }) }));
    for (const value of [CANDIDATE.name, CANDIDATE.ref, CANDIDATE.keyId]) expect(within(sheet).getByText(value).className).toContain('font-mono');
    expect(within(sheet).getByText('Compare these with mawsd keys --json on the machine. Approve only if all three match.')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(CODE);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve…' }));
    await vi.waitFor(() => expect(sent('org.enroll.approve')).toEqual([{ generation: 1, digest: CANDIDATE.digest }]));
    emit(signing(ROOT, { enrolling: null })); // listed: main's enrollment is done
    expect(await within(sheet).findByText('Enrolled gpu-box. Signed version 13.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([]);
    expect(document.body.innerHTML).not.toContain(CODE);
    expect(log.mock.calls.flat().join(' ')).not.toContain(CODE);
  });

  it('Re-enroll from a row starts as “Re-enroll <machine>”, naming the machine it replaces; a running one shows on its row', async () => {
    renderSection(signing(ROOT), { 'org.enroll.start': () => started });
    fireEvent.click(await within(await found('mini')).findByRole('button', { name: 'Re-enroll…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Re-enroll mini' });
    expect(within(sheet).queryByRole('textbox')).toBeNull();
    expect(within(sheet).getByText('mini keeps its ref and its owners. The key it posts replaces its old one, which is retired.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Make a code' }));
    await vi.waitFor(() => expect(sent('org.enroll.start')).toEqual([{ name: 'mini', replace: MINI }]));
    emit(signing(ROOT, { enrolling: enrolling({ name: 'mini', replace: MINI }) }));
    expect(await within(sheet).findByText(CODE)).toBeTruthy();
    expect(within(sheet).getByText('Waiting for mini to post its key…')).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel enrollment' }));
    await vi.waitFor(() => expect(sent('org.enroll.cancel')).toEqual([undefined]));

    // a page drawn while it runs: its line on the machine's row, and Show… takes it up without the code
    resetHarness();
    renderSection(signing(ROOT, { enrolling: enrolling({ name: 'mini', replace: MINI, generation: 4 }) }));
    const mini = await found('mini');
    expect(within(mini).getByText(/^Re-enrolling until /)).toBeTruthy();
    expect(within(mini).queryByRole('button', { name: 'Re-enroll…' })).toBeNull();
    expect(within(row('Enroll a machine')).getByRole('button', { name: 'Enroll a machine…' })).toBeTruthy(); // the new-machine row is free
    fireEvent.click(within(mini).getByRole('button', { name: 'Show…' }));
    const taken = await screen.findByRole('dialog', { name: 'Re-enroll mini' });
    expect(within(taken).getByText('The code was shown once, when it was made. For a new one, cancel and enroll again.')).toBeTruthy();
    emit(signing(ROOT, { enrolling: enrolling({ name: 'mini', replace: MINI, generation: 4, candidate: { ...CANDIDATE, name: 'mini', ref: MINI } }) }));
    fireEvent.click(within(taken).getByRole('button', { name: 'Approve…' }));
    await vi.waitFor(() => expect(sent('org.enroll.approve')).toEqual([{ generation: 4, digest: CANDIDATE.digest }]));
  });

  it('every start refusal reads in its own words, and no code shows', async () => {
    let answer: EnrollStartResult = { ok: false, reason: 'busy' };
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer });
    const sheet = await openEnroll();
    const said = new Set<string>();
    for (const reason of ENROLL_REFUSALS) {
      answer = { ok: false, reason, detail: `why-${reason}` };
      makeCode(sheet, 'gpu-box');
      await vi.waitFor(() => expect(within(sheet).getByRole('alert').textContent).toMatch(reason === 'not-root' || reason === 'not-admin' ? /\.$/ : new RegExp(`why-${reason}$`)));
      said.add(within(sheet).getByRole('alert').textContent!);
      expect(within(sheet).getByRole('button', { name: 'Make a code' })).toBeTruthy();
    }
    expect(said.size).toBe(ENROLL_REFUSALS.length);
    expect(said.has('A machine of that name is listed: re-enroll it from its row. · why-machine-name-taken')).toBe(true);
    expect(said.has('This Mac can’t sign: enroll from an admin’s Mac that does.')).toBe(true); // main's detail says the same
    expect(sent('org.enroll.start')).toHaveLength(ENROLL_REFUSALS.length);
  });

  it('every end the status names reads in its own words, the code gone, and Start over makes a new one', async () => {
    renderSection(signing(ROOT), { 'org.enroll.start': () => started });
    const sheet = await openEnroll();
    const words = {
      expired: 'The code expired before the machine posted its key. Start over.',
      'not-yours': 'The hub answers this enrollment only to the admin who started it.',
      'unknown-enrollment': 'The hub no longer knows this enrollment. Start over.',
      'key-changed': 'Another key was posted after the one shown. Start over.',
      'machine-names': 'That name is bound to another machine for the life of the org.',
    } satisfies Record<(typeof ENROLL_PROBLEMS)[number], string>;
    let generation = 0;
    for (const problem of ENROLL_PROBLEMS) {
      generation++;
      makeCode(sheet, 'gpu-box');
      emit(signing(ROOT, { enrolling: enrolling({ generation }) }));
      await within(sheet).findByText(CODE);
      emit(signing(ROOT, { enrolling: enrolling({ generation, candidate: problem === 'key-changed' ? CANDIDATE : null, problem }) }));
      expect(within(sheet).getByRole('alert').textContent).toBe(words[problem]);
      expect(document.body.innerHTML).not.toContain(CODE);
      expect(within(sheet).queryByRole('button', { name: 'Approve…' })).toBeNull();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Start over' }));
      await within(sheet).findByRole('button', { name: 'Make a code' });
    }
    expect(sent('org.enroll.start')).toHaveLength(ENROLL_PROBLEMS.length);
  });

  it('an approval that ended before Touch ID reads apart from one that ended during it; a Touch ID cancel says nothing and Approve stays', async () => {
    let settle: (result: SignResult) => void = () => {};
    renderSection(signing(ROOT), { 'org.enroll.start': () => started, 'org.enroll.approve': () => new Promise<SignResult>((resolve) => (settle = resolve)) });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    emit(signing(ROOT, { enrolling: enrolling({ generation: 2, candidate: CANDIDATE }) }));
    const approve = (await within(sheet).findByRole('button', { name: 'Approve…' })) as HTMLButtonElement;
    fireEvent.click(approve);
    await vi.waitFor(() => expect(sent('org.enroll.approve')).toHaveLength(1));
    await act(async () => settle({ ok: false, reason: 'cancelled' }));
    await vi.waitFor(() => expect(approve.disabled).toBe(false));
    expect(within(sheet).queryByRole('alert')).toBeNull();

    // another key posted before Touch ID: main ends it `key-changed`, then answers stale
    fireEvent.click(approve);
    await vi.waitFor(() => expect(sent('org.enroll.approve')).toHaveLength(2));
    emit(signing(ROOT, { enrolling: enrolling({ generation: 2, candidate: CANDIDATE, problem: 'key-changed' }) }));
    await act(async () => settle({ ok: false, reason: 'stale', detail: 'another key was posted after the one shown: start over' }));
    expect(await within(sheet).findByText(`${BEFORE} · another key was posted after the one shown: start over`)).toBeTruthy();
    expect(within(sheet).getByText('Another key was posted after the one shown. Start over.')).toBeTruthy();

    // cancelled elsewhere while Touch ID was open: main clears it, then answers cancelled with why
    fireEvent.click(within(sheet).getByRole('button', { name: 'Start over' }));
    makeCode(sheet, 'gpu-box');
    emit(signing(ROOT, { enrolling: enrolling({ generation: 3, candidate: CANDIDATE }) }));
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Approve…' }));
    await vi.waitFor(() => expect(sent('org.enroll.approve')).toHaveLength(3));
    emit(signing(ROOT, { enrolling: null }));
    expect(within(sheet).getByText('This enrollment is no longer running.')).toBeTruthy();
    await act(async () => settle({ ok: false, reason: 'cancelled', detail: 'the enrollment ended (cancelled, expired or refused): nothing was signed' }));
    expect(await within(sheet).findByText(DURING)).toBeTruthy();
  });

  it('the sign-in ending stops the enrollment: its own line, and nothing more is offered; closing then cancels nothing', async () => {
    renderSection(signing(ROOT), { 'org.enroll.start': () => started });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    emit(signing(ROOT, { enrolling: enrolling() }));
    await within(sheet).findByText(CODE);
    emit(signing(ROOT, { session: 'signed-out', enrolling: null }));
    expect(await within(sheet).findByText('The sign-in ended, so the enrollment stopped. Nothing was signed.')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(CODE);
    expect(within(sheet).queryByRole('button', { name: 'Start over' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Approve…' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([]);

    // a sign-in that ends before the status ever showed the enrollment: the code goes all the same
    resetHarness();
    renderSection(signing(ROOT), { 'org.enroll.start': () => started });
    const early = await openEnroll();
    makeCode(early, 'gpu-box');
    await within(early).findByText(CODE);
    emit(signing(ROOT, { session: 'signed-out' }));
    expect(await within(early).findByText('The sign-in ended, so the enrollment stopped. Nothing was signed.')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it('closing while a start is out drops its answer, and cancels; an ended enrollment’s sheet closed clears it', async () => {
    const answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel enrollment' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([undefined]); // main reads the mint's answer as cancelled
    await act(async () => answer.resolve(started));
    expect(document.body.innerHTML).not.toContain(CODE);

    // an enrollment that ended, taken up from the row and closed: cleared, so the row is free again
    resetHarness();
    renderSection(signing(ROOT, { enrolling: enrolling({ generation: 6, problem: 'expired' }) }));
    const enroll = await found('Enroll a machine');
    expect(within(enroll).getByText('The code expired before the machine posted its key. Start over.')).toBeTruthy();
    fireEvent.click(within(enroll).getByRole('button', { name: 'Show…' }));
    const taken = await screen.findByRole('dialog', { name: 'Enroll a machine' });
    fireEvent.click(within(taken).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(sent('org.enroll.cancel')).toEqual([undefined]));
  });

  it('once this Mac can’t sign, Make a code and Approve are withdrawn and the sheet says why', async () => {
    renderSection(signing(ROOT), { 'org.enroll.start': () => started, 'org.view': () => viewWith({ maySign: true }) });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    emit(signing(ROOT, { enrolling: enrolling({ candidate: CANDIDATE }) }));
    expect(await within(sheet).findByRole('button', { name: 'Approve…' })).toBeTruthy();
    resetHarness();
    renderSection(signing(ROOT, { enrolling: enrolling({ generation: 2, candidate: CANDIDATE }) }), { 'org.view': () => viewWith({ maySign: false }) });
    // without maySign the row offers nothing new, but a running enrollment can still be shown, and says why it can't approve
    fireEvent.click(await within(await found('Enroll a machine')).findByRole('button', { name: 'Show…' }));
    const taken = await screen.findByRole('dialog', { name: 'Enroll a machine' });
    expect(within(taken).queryByRole('button', { name: 'Approve…' })).toBeNull();
    expect(within(taken).getByText('This Mac can’t sign: enroll from an admin’s Mac that does.')).toBeTruthy();
    expect(within(taken).getByRole('button', { name: 'Cancel enrollment' })).toBeTruthy(); // Cancel is always there
  });
});
