// P5 O8 M4b: the enrollment sheet (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "Enroll a machine" and
// *The enrollment*): a name, or "Re-enroll <machine>" from its row; the code shown once, here only, with Copy and the line
// the machine runs; the wait, with the code's end; then the machine's name, ref and key id to compare; then the approval
// naming `{generation, digest}`. Every start refusal and every end has its own line; Cancel is always there.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { formatClock } from '@shared/app/date-format';
import { ENROLL_PROBLEMS, ENROLL_REFUSALS, type EnrollStartResult, type OrgEnrollingStatus, type SignResult } from '@shared/ipc/schema/org';
import { observed, started as startedRun, type EnrollRun } from './EnrollSheet';
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
const started: EnrollStartResult = { ok: true, code: CODE, expires: EXPIRES, generation: 1 };
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
    expect(within(sheet).getByText('Shown once, here only.')).toBeTruthy();
    expect(within(sheet).getByText(`The code works until ${formatClock(Date.parse(EXPIRES))}.`)).toBeTruthy();
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
    await vi.waitFor(() => expect(sent('org.enroll.cancel')).toEqual([{ generation: 1 }]));

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
    // each its own explanation, not its detail's: the same detail for all, then none
    for (const detail of ['the same detail', undefined]) {
      const lines = new Set<string>();
      for (const reason of ENROLL_REFUSALS) {
        answer = detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
        const asked = sent('org.enroll.start').length;
        makeCode(sheet, 'gpu-box');
        await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(asked + 1));
        await act(async () => {}); // its answer drawn
        lines.add(within(sheet).getByRole('alert').textContent!);
        expect(within(sheet).getByRole('button', { name: 'Make a code' })).toBeTruthy();
        expect(document.body.innerHTML).not.toContain('mawsenroll2');
      }
      expect(lines.size, `each refusal explained apart, with ${detail ?? 'no detail'}`).toBe(ENROLL_REFUSALS.length);
    }
    expect(sent('org.enroll.start')).toHaveLength(ENROLL_REFUSALS.length * 2);
  });

  // U11a board 540 (§B): every reason main gives a start, with its detail as main words it, and the exact line drawn: main's
  // detail follows the line only where it says something the line does not
  it('each start refusal, given main’s detail, draws its line once, and the detail only where it adds to the line', async () => {
    const drawn: Record<(typeof ENROLL_REFUSALS)[number], readonly (readonly [string, string])[]> = {
      'not-root': [
        ['this Mac is not signed in to the org', 'This Mac can’t sign: enroll from an admin’s Mac that does.'],
        ["This Mac can't sign: enroll from an admin's Mac that does", 'This Mac can’t sign: enroll from an admin’s Mac that does.'],
      ],
      'not-admin': [['Only an admin enrolls a machine', 'Only an admin enrolls a machine.']],
      busy: [['an enrollment is under way: cancel it first', 'Another enrollment, pairing or sign-in is running. · an enrollment is under way: cancel it first']],
      hub: [
        ['the hub sign-in has ended', 'This Mac isn’t connected to the hub. Sign in again to enroll. · the hub sign-in has ended'],
        ['the hub was not reached: down', 'This Mac isn’t connected to the hub. Sign in again to enroll. · the hub was not reached: down'],
      ],
      shape: [['"a/b" is not an admitted machine name', 'A machine name is up to 63 letters, digits, dots, hyphens or underscores, starts with a letter or digit, and is not "hub" or "legacy".']],
      'machine-name-taken': [['gpu-box is listed: re-enroll it from its row', 'A machine of that name is listed: re-enroll it from its row.']],
      'prefix-names-machine': [['dc-vm9 falls under the delegation prefix dc-', 'That name starts with a delegation’s prefix, which is kept for the machines that delegation certifies. Choose a name outside it. · dc-vm9 falls under the delegation prefix dc-']],
      'certified-machine': [['a certified machine is enrolled again through its delegation, never from here', 'A certified machine is enrolled again through its delegation.']],
      'no-machine': [['the org state lists no machine by that ref', 'The org no longer lists this machine. Close this sheet and enroll it as a new machine.']],
      refused: [['403 not-admin', 'The hub refused the enrollment. Try again; if it is refused again, sign in to the hub again under Org. · 403 not-admin']],
      cancelled: [['the enrollment was cancelled while its token was minted: nothing was shown', 'The enrollment was cancelled before its code was shown.']],
    };
    let answer: EnrollStartResult = { ok: false, reason: 'busy' };
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer });
    const sheet = await openEnroll();
    for (const reason of ENROLL_REFUSALS) {
      for (const [detail, words] of drawn[reason]) {
        answer = { ok: false, reason, detail };
        const asked = sent('org.enroll.start').length;
        makeCode(sheet, 'gpu-box');
        await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(asked + 1));
        await act(async () => {}); // its answer drawn
        expect(within(sheet).getByRole('alert').textContent, `${reason}, ${detail}`).toBe(words);
      }
    }
  });

  it('every end the status names reads in its own words, the code gone, and Start over makes a new one', async () => {
    renderSection(signing(ROOT), { 'org.enroll.start': () => ({ ...started, generation: sent('org.enroll.start').length }) }); // each start's own run
    const sheet = await openEnroll();
    const words = {
      expired: 'The enrollment expired before it was approved. Start over.',
      'not-yours': 'Another admin started this enrollment, and the hub answers only to them. Ask them to finish it, or Start over to enroll the machine yourself.',
      'unknown-enrollment': 'The hub no longer knows this enrollment. Start over.',
      'key-changed': 'Another key was posted after the one shown. Start over.',
      'machine-names': 'That name is bound to another machine for the life of the org. Start over with a different name.',
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
    renderSection(signing(ROOT), { 'org.enroll.start': () => ({ ...started, generation: sent('org.enroll.start').length + 1 }), 'org.enroll.approve': () => new Promise<SignResult>((resolve) => (settle = resolve)) });
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
  });

  it('closing while a start is out drops its answer, and cancels; an ended enrollment’s sheet closed clears it', async () => {
    const answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel enrollment' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([{ generation: null }]); // the start whose run isn't shown yet: main reads the mint's answer as cancelled
    await act(async () => answer.resolve(started));
    expect(document.body.innerHTML).not.toContain(CODE);

    // an enrollment that ended, taken up from the row and closed: cleared, so the row is free again
    resetHarness();
    renderSection(signing(ROOT, { enrolling: enrolling({ generation: 6, problem: 'expired' }) }));
    const enroll = await found('Enroll a machine');
    expect(within(enroll).getByText('The enrollment expired before it was approved. Start over.')).toBeTruthy();
    fireEvent.click(within(enroll).getByRole('button', { name: 'Show…' }));
    const taken = await screen.findByRole('dialog', { name: 'Enroll a machine' });
    fireEvent.click(within(taken).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(sent('org.enroll.cancel')).toEqual([{ generation: 6 }]));
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

  // The review's mid-flight probe (fix wave): a sheet owns one run under one sign-in, and nothing later takes it over.
  it('a sheet following an enrollment that ended never adopts a later one, nor cancels it', async () => {
    const later = { name: 'other-box', ref: 'OtherBoxRef000000011', keyId: 'otherBoxKey0001', digest: 'otherDigest' };
    renderSection(signing(ROOT, { enrolling: enrolling({ generation: 7, name: 'first-box' }) }));
    fireEvent.click(await within(await found('Enroll a machine')).findByRole('button', { name: 'Show…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Enroll a machine' });
    emit(signing(ROOT, { enrolling: null }));
    expect(await within(sheet).findByText('This enrollment is no longer running.')).toBeTruthy();
    emit(signing(ROOT, { enrolling: enrolling({ generation: 8, name: 'other-box', candidate: later }) }));
    expect(within(sheet).queryByText(later.ref)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Approve…' })).toBeNull();
    expect(within(sheet).getByText('This enrollment is no longer running.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([]); // generation 8 isn't this sheet's to cancel
  });

  it('a start answered after the sign-in ended leaves the sheet ended: no chooser, no refusal, no code', async () => {
    let answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    let sheet = await openEnroll();
    makeCode(sheet, 'first-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    emit(signing(ROOT, { session: 'signed-out' }));
    const ended = 'The sign-in ended, so the enrollment stopped. Nothing was signed.';
    expect(await within(sheet).findByText(ended)).toBeTruthy();
    await act(async () => answer.resolve({ ok: false, reason: 'cancelled', detail: 'the enrollment was cancelled while its token was minted: nothing was shown' }));
    expect(within(sheet).getByText(ended)).toBeTruthy();
    expect(within(sheet).queryByRole('textbox')).toBeNull();
    expect(within(sheet).queryByRole('alert')).toBeNull();

    // nor does a late code: it is never drawn
    resetHarness();
    answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    sheet = await openEnroll();
    makeCode(sheet, 'first-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    emit(signing(ROOT, { session: 'signed-out' }));
    await act(async () => answer.resolve(started));
    expect(within(sheet).getByText(ended)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(CODE);
    // and the same member signing in again doesn't revive it
    await act(async () => emit(signing(ROOT)));
    await vi.waitFor(() => expect(sent('org.view').length).toBeGreaterThan(1)); // the page read again under the new sign-in
    await act(async () => {});
    expect(within(sheet).getByText(ended)).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Start over' })).toBeNull();
  });

  // The re-review's ownership probe (fix wave 2): the sheet's sign-in latch outlives its run.
  it('a sheet whose run ended before the sign-out offers nothing under the next sign-in', async () => {
    renderSection(signing(ROOT, { enrolling: enrolling({ generation: 7, name: 'first-box' }) }));
    fireEvent.click(await within(await found('Enroll a machine')).findByRole('button', { name: 'Show…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Enroll a machine' });
    emit(signing(ROOT, { enrolling: null }));
    expect(await within(sheet).findByText('This enrollment is no longer running.')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Start over' })).toBeTruthy(); // its own sign-in stands
    emit(signing(ROOT, { session: 'signed-out', enrolling: null }));
    await vi.waitFor(() => expect(sent('org.view')).toHaveLength(3));
    await act(async () => {});
    emit(signing(ROOT, { enrolling: null })); // signed in again: another sign-in, though the same member and device
    await vi.waitFor(() => expect(sent('org.view')).toHaveLength(4));
    await act(async () => {});
    expect(within(sheet).queryByRole('button', { name: 'Start over' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Make a code' })).toBeNull();
    expect(within(sheet).getByText('The sign-in this sheet opened under ended. Close it to enroll again.')).toBeTruthy();
  });

  it('a start whose answer is out owns no run another window shows: closing cancels only its own start, and a late code never shows', async () => {
    const answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    const sheet = await openEnroll();
    makeCode(sheet, 'first-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    emit(signing(ROOT, { enrolling: enrolling({ generation: 8, name: 'other-box', candidate: CANDIDATE }) }));
    await act(async () => {});
    expect(within(sheet).queryByText(CANDIDATE.ref)).toBeNull();
    // its answer, for a run that isn't the one shown (main's, ended at once): ended, no code
    await act(async () => answer.resolve({ ...started, generation: 7 }));
    expect(await within(sheet).findByText('This enrollment is no longer running.')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(CODE);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel'), 'generation 8 is another window’s').toEqual([]);
  });

  // The branch review's race (P2-1): two windows start the same name; the other's run shows before this start's answer.
  it('a start acts on no generation before its own answer: another window’s run of the same name is never approved nor cancelled by number', async () => {
    const answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    emit(signing(ROOT, { enrolling: enrolling({ generation: 1, candidate: CANDIDATE }) })); // the other window's run, its key posted
    await act(async () => {});
    expect(within(sheet).queryByText(CANDIDATE.ref)).toBeNull();
    expect((within(sheet).getByRole('button', { name: 'Approve…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => answer.resolve({ ok: false, reason: 'busy', detail: 'an enrollment is under way: cancel it first' }));
    expect(within(sheet).getByRole('alert').textContent).toContain('Another enrollment, pairing or sign-in is running.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([]);

    // closed before its answer came: only its own start, by the sender's null, never that run's number
    resetHarness();
    renderSection(signing(ROOT), { 'org.enroll.start': () => new Promise<EnrollStartResult>(() => {}) });
    const again = await openEnroll();
    makeCode(again, 'gpu-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    emit(signing(ROOT, { enrolling: enrolling({ generation: 1 }) }));
    await act(async () => {});
    fireEvent.click(within(again).getByRole('button', { name: 'Cancel enrollment' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([{ generation: null }]);
  });

  // The ownership round's probes (fix wave 4): the start's answer names its run, and that run alone is the sheet's.
  it('a run that ended before its start’s answer came shows ended: no code, no Approve, nothing to cancel', async () => {
    const answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    emit(signing(ROOT, { enrolling: enrolling({ generation: 1 }) })); // main publishes the run, then answers
    emit(signing(ROOT, { enrolling: null })); // and the run ends before that answer is drawn
    await act(async () => answer.resolve({ ...started, generation: 1 }));
    expect(await within(sheet).findByText('This enrollment is no longer running.')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(CODE);
    expect(within(sheet).queryByRole('button', { name: 'Approve…' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([]);
  });

  it('a late answer never attaches the sheet to another window’s later run of the same name, nor cancels it', async () => {
    const answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    emit(signing(ROOT, { enrolling: enrolling({ generation: 1 }) }));
    emit(signing(ROOT, { enrolling: null }));
    emit(signing(ROOT, { enrolling: enrolling({ generation: 2, candidate: CANDIDATE }) })); // another window's start, the same name
    await act(async () => answer.resolve({ ...started, generation: 1 }));
    expect(await within(sheet).findByText('This enrollment is no longer running.')).toBeTruthy();
    expect(within(sheet).queryByText(CANDIDATE.ref)).toBeNull();
    expect(document.body.innerHTML).not.toContain(CODE);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel'), 'generation 2 is the other window’s').toEqual([]);
  });

  it('the answer’s generation is the sheet’s exactly: its code and Approve, and its number alone to cancel', async () => {
    const answer = deferred<EnrollStartResult>();
    renderSection(signing(ROOT), { 'org.enroll.start': () => answer.promise });
    const sheet = await openEnroll();
    makeCode(sheet, 'gpu-box');
    await vi.waitFor(() => expect(sent('org.enroll.start')).toHaveLength(1));
    emit(signing(ROOT, { enrolling: enrolling({ generation: 4 }) }));
    await act(async () => answer.resolve({ ...started, generation: 4 }));
    expect(await within(sheet).findByText(CODE)).toBeTruthy();
    emit(signing(ROOT, { enrolling: enrolling({ generation: 4, candidate: CANDIDATE }) }));
    expect(await within(sheet).findByText(CANDIDATE.ref)).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Approve…' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel enrollment' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent('org.enroll.cancel')).toEqual([{ generation: 4 }]);
  });

  it('a reopened enrollment waiting for its key still shows when it ends', async () => {
    renderSection(signing(ROOT, { enrolling: enrolling({ generation: 7 }) }));
    fireEvent.click(await within(await found('Enroll a machine')).findByRole('button', { name: 'Show…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Enroll a machine' });
    expect(within(sheet).getByText(`The code works until ${formatClock(Date.parse(EXPIRES))}.`)).toBeTruthy();
    expect(within(sheet).getByText('The code was shown once, when it was made. For a new one, cancel and enroll again.')).toBeTruthy();
  });
});

describe('the enrollment sheet’s run, at the state boundary (fix wave)', () => {
  const run = (patch: Partial<Extract<EnrollRun, { at: 'running' }>> = {}): EnrollRun => ({ at: 'running', owner: 'org/me/dev', generation: 3, token: 1, code: { value: CODE, expires: EXPIRES }, ...patch });
  const status = (patch: Partial<NonNullable<OrgEnrollingStatus>> = {}) => enrolling({ generation: 3, ...patch });

  it('drops the code once the machine posts its key, or the run ends with a problem', () => {
    expect(observed(run(), status(), 'org/me/dev')).toMatchObject({ at: 'running', code: { value: CODE } });
    expect(observed(run(), status({ candidate: CANDIDATE }), 'org/me/dev')).toMatchObject({ at: 'running', code: null });
    expect(observed(run(), status({ problem: 'expired' }), 'org/me/dev')).toMatchObject({ at: 'running', code: null });
  });

  it('ends for good when the run leaves the status, another takes its place, or the sign-in changes', () => {
    expect(observed(run(), null, 'org/me/dev')).toEqual({ at: 'ended', why: 'gone', generation: 3 });
    expect(observed(run(), status({ generation: 4 }), 'org/me/dev')).toEqual({ at: 'ended', why: 'gone', generation: 3 });
    expect(observed(run(), status(), null)).toEqual({ at: 'ended', why: 'signed-out', generation: 3 });
    expect(observed(run(), status(), 'org/someone-else/dev')).toEqual({ at: 'ended', why: 'signed-out', generation: 3 });
    const ended: EnrollRun = { at: 'ended', why: 'gone', generation: 3 };
    expect(observed(ended, status({ generation: 4 }), 'org/me/dev')).toBe(ended);
  });

  // Every start answers before another can begin (a run is latched only after its own answer), so a late answer can't
  // meet a later start through the sheet; the token fence stands behind that, pinned here.
  it('a start’s answer lands only on the start that sent it, while it still waits on it', () => {
    const second: EnrollRun = { at: 'starting', owner: 'org/me/dev', token: 2 };
    expect(startedRun(second, 1, { ok: true, code: 'mawsenroll2.the-first-start-s-code', expires: EXPIRES, generation: 1 })).toBe(second);
    expect(startedRun(second, 1, { ok: false, reason: 'busy' })).toBe(second);
    expect(startedRun(second, 2, { ok: false, reason: 'busy' })).toEqual({ at: 'choosing', refused: { ok: false, reason: 'busy' } });
    const ended: EnrollRun = { at: 'ended', why: 'gone', generation: 1 };
    expect(startedRun(ended, 2, started)).toBe(ended);
  });

  it('a start owns exactly the generation its answer names, and no run before it', () => {
    const starting: EnrollRun = { at: 'starting', owner: 'org/me/dev', token: 1 };
    // while its answer is out, no run is its own, whatever its name or generation
    for (const shown of [status({ generation: 2 }), status({ generation: 3 }), status({ generation: 3, name: 'other-box' }), status({ generation: 3, replace: MINI }), null]) {
      expect(observed(starting, shown, 'org/me/dev')).toBe(starting);
    }
    expect(observed(starting, null, null)).toEqual({ at: 'ended', why: 'signed-out', generation: null });
    // its answer latches the generation it names, with its code
    const answered = startedRun(starting, 1, { ...started, generation: 3 });
    expect(answered).toEqual({ at: 'running', owner: 'org/me/dev', generation: 3, token: 1, code: { value: CODE, expires: EXPIRES } });
    expect(observed(answered, status({ generation: 3 }), 'org/me/dev')).toBe(answered);
    // and no other: a run of the same name at another generation ends it, before or after
    expect(observed(answered, status({ generation: 4 }), 'org/me/dev')).toEqual({ at: 'ended', why: 'gone', generation: 3 });
    expect(observed(answered, status({ generation: 2 }), 'org/me/dev')).toEqual({ at: 'ended', why: 'gone', generation: 3 });
  });
});
