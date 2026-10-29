// e2e:lane-a (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M5 "Proves"; acceptance 1, 2, 4 and 6): a
// terminal session on this Mac driven from MAWS through its bridge, the bridge being the fake (test/support/
// fake-bridge.ts) on the launch's scratch sminos home, and no `claude` running. Each control's body as the fake receives
// it; sends in order, a refusal keeping its draft, a held send's strip; a side question answered from its op's end; the
// gaps greyed with their reasons; no bridge as before; the reply streaming, then its row; a pane opened mid-reply, and
// that turn aborted with no `step end`, its text kept settled. M6 (acceptance 3 and 5): the requests the bridge raises, as attention items and
// docked cards answered through the port, each decision's body as the fake receives it, and the race with the terminal.
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { FULL_CAPABILITIES, startFakeBridge, type FakeBridge } from '../test/support/fake-bridge';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { launchMaws, test, type MawsLaunch } from './support/launch';
import { assistantRecord, backgroundAgentRecords, backgroundAgentSidecars, backgroundBashRecords, CATALOG, editTurnRecords, taskNotificationRecord, terminalSession, userRecord, type TerminalSession } from './support/lane-a';
import { addressed } from './support/address';
import { openSurface } from './support/shell';
import { sidebarOf, sidebarRow } from './support/sidebar';

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name as string, input as unknown] as const) as Promise<CommandResult<N>>;
}

function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

interface Case {
  maws: MawsLaunch;
  page: Page;
  store: StoreFixture;
  repo: ScratchRepo;
  sid: string;
  appId: string;
  transcript: string;
  terminal: TerminalSession | null;
}

const T0 = '2026-10-28T10:00:00.000Z';
const main = (page: Page) => page.locator('[data-region="main"]');
const editor = (page: Page) => main(page).getByRole('textbox', { name: 'Message' });
const notice = (page: Page) => main(page).getByRole('note');
const strip = (page: Page) => main(page).getByRole('list', { name: 'Messages not confirmed yet' });

// The bridge's sentence as MAWS shows one: its first letter capitalised (session/controls/lane-a.ts).
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The fake's commands of one op, their bodies in order.
const bodies = (bridge: FakeBridge, op: string) => bridge.commands.filter((c) => c.op === op).map((c) => c.body);

// M6: the pane's request card (docked in the composer's place), and the decisions the fake took, each with its request.
const card = (page: Page) => main(page).locator('[data-request-card]');
const decided = (bridge: FakeBridge) => bridge.decisions.map((d) => ({ request: d.request, ...d.body }));
const AS_MAWS = { by: 'maws', launch: 'launch-1' }; // every decision MAWS posts names itself and the launch it was read under
const badge = (maws: MawsLaunch) => maws.app.evaluate(({ app }) => app.dock?.getBadge() ?? '');

// MAWS's answer went: the bridge settles the request as MAWS's, and the card leaves at once (only another's win lingers).
async function settledHere(page: Page, bridge: FakeBridge, request: string, outcome = 'allow'): Promise<void> {
  bridge.settle(request, 'web', outcome);
  await expect(card(page)).toHaveCount(0, { timeout: 5_000 });
}

test.describe('lane A: a terminal session driven through its bridge', () => {
  let current: Case | null = null;
  test.afterEach(async () => {
    const c = current;
    current = null;
    if (!c) return;
    try {
      await c.terminal?.close();
      await c.maws.cleanup();
    } finally {
      c.repo.dispose();
      await c.store.dispose();
    }
  });

  // A launch over an engine store holding the session's transcript (one exchange, then the rows `more` gives after its
  // answer), the session in the sidebar.
  async function begin(more: (sid: string, cwd: string, after: string) => Record<string, unknown>[] = () => []): Promise<Case> {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sid = randomUUID();
    const prompt = randomUUID();
    const answer = randomUUID();
    const transcript = await store.addTranscript(repo.root, sid, [
      JSON.stringify(userRecord(sid, repo.root, prompt, null, 'Tell me a story.', T0)),
      JSON.stringify(assistantRecord(sid, repo.root, answer, prompt, 'A short one, then.', '2026-10-28T10:00:02.000Z')),
      ...more(sid, repo.root, answer).map((row) => JSON.stringify(row)),
    ]);
    const maws = await launchMaws({ env: { CLAUDE_CONFIG_DIR: store.configHome } });
    const { page } = maws;
    await expect(main(page)).toBeVisible();
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
    const appId = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!.appId;
    current = { maws, page, store, repo, sid, appId, transcript, terminal: null };
    return current;
  }

  // The terminal holds the session (with its bridge unless `bridged` is false), and its pane is open.
  async function drive(c: Case, opts: { bridged?: boolean; open?: boolean } = {}): Promise<TerminalSession> {
    c.terminal = await terminalSession({ store: c.store, sminosHome: c.maws.sminosHome, sessionId: c.sid, cwd: c.repo.root, bridged: opts.bridged ?? true });
    await expect.poll(async () => value(await invoke(c.page, 'session.get', { appSessionId: c.appId }))?.holder.kind, { timeout: 10_000 }).toBe('terminal');
    if (opts.open !== false) await open(c);
    return c.terminal;
  }

  async function open(c: Case): Promise<void> {
    await (await sidebarRow(c.page, { appSessionId: c.appId })).click();
    await expect(editor(c.page), 'the composer, in place of the holder notice').toBeVisible({ timeout: 15_000 });
  }

  async function typeAndSend(page: Page, text: string): Promise<void> {
    const box = editor(page);
    await box.click();
    await box.pressSequentially(text);
    await box.press('Enter');
  }

  async function clear(box: Locator): Promise<void> {
    await box.click();
    await box.press('ControlOrMeta+a');
    await box.press('Backspace');
  }

  test('no bridge: the holder notice and Take over here, as before; a live bridge then gives the composer, its gaps greyed with their reasons', async () => {
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      return [userRecord(sid, cwd, ask, after, 'Change once to twice.', '2026-10-28T10:00:03.000Z'), ...editTurnRecords(sid, cwd, ask, { file: `${cwd}/notes.md`, at: '2026-10-28T10:00:04.000Z' })];
    });
    const { page } = c;
    c.terminal = await terminalSession({ store: c.store, sminosHome: c.maws.sminosHome, sessionId: c.sid, cwd: c.repo.root, bridged: false });
    await expect.poll(async () => value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.holder.kind, { timeout: 10_000 }).toBe('terminal');
    await (await sidebarRow(page, { appSessionId: c.appId })).click();
    await expect(notice(page)).toContainText(`Live in Terminal · pid ${c.terminal.pid} · read-only`);
    await expect(notice(page).getByRole('button', { name: 'Take over here' })).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
    expect(value(await invoke(page, 'laneA.list', undefined)).states, 'no answering bridge, no state').toEqual([]);

    // its bridge comes up: the composer replaces the notice, and what lane A can't do is greyed with why
    const bridge = await startFakeBridge({ home: c.maws.sminosHome, session: c.sid, pid: c.terminal.pid, sessionInfo: { session: c.sid, cwd: c.repo.root, model: 'claude-opus-4-5', version: '2.1.300' } });
    bridge.emit({ type: 'catalog', ...CATALOG });
    const registryOnly = c.terminal;
    c.terminal = { bridge, pid: registryOnly.pid, close: async () => (await bridge.close(), await registryOnly.close()) };
    await expect(editor(page)).toBeVisible({ timeout: 15_000 });
    await expect(notice(page)).toHaveCount(0);
    // the owner's Q1: its tab marks it Terminal, titled with the hover card's line
    const marker = page.locator('[role="tab"][aria-selected="true"] [data-holder-marker]');
    await expect(marker).toHaveText('Terminal');
    await expect(marker).toHaveAttribute('title', 'Running in Terminal · driven through sminos’s bridge');
    // acceptance 2: each gap in place with its reason, the bridge's words from the capability fixture
    const reasonOf = (key: string) => sentence(FULL_CAPABILITIES.controls![key]!.reason!);
    // the O9 sitting: no mode is reported, so the chip names none, only why
    const mode = main(page).getByRole('button', { name: 'Permission mode not reported' });
    await expect(mode).toHaveAttribute('title', 'Not reported by the terminal session: its mode is changed in the terminal');
    await expect(mode).toHaveText(/^Mode/);
    await editor(page).click();
    await editor(page).pressSequentially('/doc');
    await expect(page.getByRole('option', { name: /doctor/ }), 'a command only the terminal runs, listed with why').toContainText(/runs only in the terminal/i);
    await clear(editor(page));
    await editor(page).pressSequentially('/rewind');
    await expect(page.getByRole('option', { name: /rewind/ }).first(), 'rewind, a terminal panel').toContainText('Rewind is a terminal panel: use /rewind there');
    await page.keyboard.press('Escape');
    await clear(editor(page));
    await main(page).getByRole('button', { name: 'Turn summary' }).last().click();
    const restore = page.getByRole('button', { name: 'Restore files to before this turn' });
    await expect(restore, 'file rollback, in place').toBeDisabled();
    await expect(restore).toHaveAttribute('title', reasonOf('rewind-files'));
    await page.keyboard.press('Escape');
    // Session info lists every control the bridge doesn't reach, with its reason. Forget and the queue have no control of
    // their own on a terminal session; the cards' gaps (deny-and-interrupt, an edited input, a plan's clear, a form) are
    // each card's (M6's scene); MCP disable is the /mcp widget's (the controls scene).
    await openSurface(page, 'Session info');
    const info = page.locator('[data-region="panel"] [data-surface][aria-label="Session info"]');
    await expect(info).toContainText('Not available here');
    for (const [label, reason] of [
      ['Permission mode', "A terminal session's mode is changed in the terminal"],
      ['Rewind', 'Rewind is a terminal panel: use /rewind there'],
      ['Forget a message', reasonOf('forget')],
      ['Roll back files', reasonOf('rewind-files')],
      ['Deny and interrupt', reasonOf('decide.interrupt')],
      ['Answer a form', 'Answer this form in the terminal'],
      ['Disable an MCP server', reasonOf('mcp.disable')],
      ['Queue', 'The terminal keeps its own queue'],
    ] as const) {
      await expect(info, label).toContainText(label);
      await expect(info, label).toContainText(reason);
    }
    // the session menu offers Take over in MAWS, the pane no longer showing the notice that carried it
    await (await sidebarRow(page, { appSessionId: c.appId })).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Take over in MAWS' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // The O9 sitting (item 6): after `/exit` the session left the sidebar. The terminal ending (its registry record and its
  // bridge gone) leaves it listed, as an ended lane B session is, and no longer marked Terminal.
  test('the terminal ending: the session stays listed, held by nothing, its bridge state gone', async () => {
    const c = await begin();
    const { page } = c;
    const terminal = await drive(c);
    const row = await sidebarRow(page, { appSessionId: c.appId });
    await expect(page.locator('[role="tab"][aria-selected="true"] [data-holder-marker]')).toHaveText('Terminal');
    await terminal.close();
    c.terminal = null;
    await expect.poll(async () => value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.holder.kind, { timeout: 10_000 }).toBe('none');
    await expect.poll(async () => value(await invoke(page, 'laneA.state', { appSessionId: c.appId })), { timeout: 10_000 }).toBeNull();
    await expect(page.locator('[role="tab"][aria-selected="true"] [data-holder-marker]')).toHaveCount(0);
    expect(value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.archived).toBe(false);
    await expect(row, 'still listed once nothing holds it').toBeVisible();
    await expect((await sidebarRow(page, { appSessionId: c.appId })), 'and found again from the list').toBeVisible();
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('the jobs list: a background shell the transcript started runs, its Stop reaches the bridge, and the transcript ending it ends it', async () => {
    const shellJob = { taskId: 'bsleep01', command: 'sleep 600', description: 'Wait ten minutes', at: '2026-10-28T10:00:03.000Z' };
    const c = await begin((sid, cwd, after) => backgroundBashRecords(sid, cwd, after, shellJob));
    const { page } = c;
    const { bridge } = await drive(c);
    await openSurface(page, 'Background work');
    const shell = page.locator('[data-shell="bsleep01"]');
    await expect(shell, 'derived by main from the transcript, carried by the watch').toContainText('Wait ten minutes · running', { timeout: 15_000 });
    await expect(shell.getByRole('button', { name: 'Output' }), 'a local job has no output tail').toHaveCount(0);
    await shell.getByRole('button', { name: 'Stop' }).click();
    await expect.poll(() => bodies(bridge, 'stop')).toEqual([{ op: 'stop', taskId: 'bsleep01' }]);
    await expect(shell.getByRole('button', { name: 'stopping…' })).toBeVisible();
    // the engine's notification that it ended, as the transcript records it
    await c.store.appendLines(c.transcript, [JSON.stringify(taskNotificationRecord(c.sid, c.repo.root, randomUUID(), { taskId: 'bsleep01', status: 'killed', summary: 'Background command "Wait ten minutes" was stopped', at: '2026-10-28T10:00:09.000Z' }))]);
    await expect(shell).toContainText('Wait ten minutes · stopped', { timeout: 10_000 });
    await expect(shell.getByRole('button')).toHaveCount(0);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('sends: two in order; one refused at once keeps its draft with the reason; one held past 5 s goes to the strip, which shows its refusal and lets an entered one go, the new draft untouched', async () => {
    test.setTimeout(120_000);
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);

    await typeAndSend(page, 'first words');
    await expect(editor(page)).toHaveText('');
    await typeAndSend(page, 'second words');
    await expect.poll(() => bodies(bridge, 'deliver').map((b) => b.text), { timeout: 10_000 }).toEqual(['first words', 'second words']);
    expect(bodies(bridge, 'deliver').map((b) => (b.key as { seq: number }).seq), 'keys in order').toEqual([1, 2]);

    bridge.answer('deliver', () => ({ status: 200, body: { ok: false, code: 'busy', error: 'the terminal is busy' } }));
    await typeAndSend(page, 'refuse me');
    await expect(page.getByText('the terminal is busy', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(editor(page), 'the refused draft stays').toHaveText('refuse me');
    await clear(editor(page));

    // held: the bridge takes the key and names no fate; at 5 s the composer clears and the strip keeps the words
    bridge.answer('deliver', () => ({ status: 200, body: { ok: true, result: { submitted: true } } }));
    await typeAndSend(page, 'held words');
    const held = strip(page).locator('li', { hasText: 'held words' });
    await expect(held).toHaveAttribute('data-pending-send', 'sending', { timeout: 15_000 });
    await expect(editor(page)).toHaveText('');
    await editor(page).pressSequentially('a new draft');
    const heldKey = bodies(bridge, 'deliver').at(-1)!.key;
    bridge.emit({ type: 'delivered', key: heldKey, outcome: 'refused', reason: 'the prompt was cleared in the terminal' });
    await expect(held).toHaveAttribute('data-pending-send', 'refused', { timeout: 10_000 });
    await expect(held).toContainText('Not entered: the prompt was cleared in the terminal');
    await expect(held.getByRole('button', { name: 'Send again' })).toBeVisible();
    await expect(editor(page), 'the draft typed since is untouched').toHaveText('a new draft');

    // another held one, then entered: its entry leaves, the refused one stays
    await editor(page).press('Enter');
    const second = strip(page).locator('li', { hasText: 'a new draft' });
    await expect(second).toHaveAttribute('data-pending-send', 'sending', { timeout: 15_000 });
    bridge.emit({ type: 'delivered', key: bodies(bridge, 'deliver').at(-1)!.key, outcome: 'entered', uuid: randomUUID() });
    await expect(second).toHaveCount(0, { timeout: 10_000 });
    await expect(held).toHaveCount(1);
    await held.getByRole('button', { name: 'Dismiss' }).click();
    await expect(strip(page)).toHaveCount(0);
  });

  // M7 (acceptance 7): files dropped on the real composer go through its serialization, `laneA.media` and main's save,
  // and the fake receives `media {upload, root, files}` naming files under the root that hold the bytes, then the words.
  test('attachments: an image and a PDF dropped on the composer reach the bridge’s media op as saved files, then the words; each file’s state shows', async () => {
    test.setTimeout(120_000);
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
    const drop = (files: { name: string; type: string; base64: string }[]) =>
      editor(page).evaluate((target, given) => {
        const data = new DataTransfer();
        for (const f of given) data.items.add(new File([Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0))], f.name, { type: f.type }));
        const box = target.getBoundingClientRect();
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: box.left + 5, clientY: box.top + 5, bubbles: true, cancelable: true }));
      }, files);
    const attached = main(page).getByRole('list', { name: 'attachments' });
    const uploads = main(page).getByRole('list', { name: 'Images and PDFs sent to the terminal session' });
    const fileRow = (name: string) => uploads.locator('[data-upload-state]', { hasText: name });

    await drop([{ name: 'shot.png', type: 'image/png', base64: PNG }, { name: 'notes.pdf', type: 'application/pdf', base64: PDF.toString('base64') }]);
    await expect(attached.getByText('shot.png')).toBeVisible();
    await expect(attached.getByText('notes.pdf')).toBeVisible();
    await typeAndSend(page, 'what are these?');
    await expect.poll(() => bodies(bridge, 'deliver').map((b) => b.text), { timeout: 10_000 }).toEqual(['what are these?']);
    expect(bridge.commands.map((cmd) => cmd.op).filter((op) => op === 'media' || op === 'deliver'), 'the files first, then the words').toEqual(['media', 'deliver']);
    await expect(attached).toHaveCount(0);

    const [media] = bodies(bridge, 'media') as { upload: string; root: string; files: { n: number; path: string; name: string; mediaType: string }[] }[];
    const root = join(realpathSync(c.repo.root), '.claude', 'desk-uploads', c.sid);
    expect(media).toEqual({
      op: 'media', upload: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) as unknown, root,
      files: [
        { n: 0, path: join(root, `${media!.upload}.0.png`), name: 'shot.png', mediaType: 'image/png' },
        { n: 1, path: join(root, `${media!.upload}.1.pdf`), name: 'notes.pdf', mediaType: 'application/pdf' },
      ],
    });
    expect(readFileSync(media!.files[0]!.path).subarray(0, 8), 'the composer’s image, a PNG').toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(readFileSync(media!.files[1]!.path), 'the PDF as dropped').toEqual(PDF);
    expect(readFileSync(join(c.repo.root, '.git', 'info', 'exclude'), 'utf8')).toContain('**/.claude/desk-uploads/');

    // each file's state as the bridge says it: read, then one sent on to the model and one that failed, which stays
    await expect(fileRow('shot.png')).toHaveAttribute('data-upload-state', 'queued');
    const { upload } = media!;
    const said = (index: number, state: string, phase: 'start' | 'end', attachments: { index: number; state: string; reason?: string }[]) =>
      bridge.emit({ type: 'media', id: upload, upload, index, state, phase, attachments, ...(attachments[index]?.reason !== undefined && { reason: attachments[index]!.reason }) });
    said(0, 'read', 'start', [{ index: 0, state: 'read' }, { index: 1, state: 'pending' }]);
    await expect(fileRow('shot.png')).toContainText('Read', { timeout: 5_000 });
    const reason = 'the Read returned no image or document';
    said(1, 'failed', 'start', [{ index: 0, state: 'read' }, { index: 1, state: 'failed', reason }]);
    said(0, 'forwarded', 'end', [{ index: 0, state: 'forwarded' }, { index: 1, state: 'failed', reason }]);
    await expect(fileRow('shot.png')).toContainText('Sent to the model', { timeout: 5_000 });
    await expect(fileRow('notes.pdf')).toContainText(`Not read: ${reason}`);

    // an image alone: no words go, and once it went on to the model its entry leaves by itself; the upload with a file
    // that did not go on stays until dismissed
    await drop([{ name: 'again.png', type: 'image/png', base64: PNG }]);
    await expect(attached.getByText('again.png')).toBeVisible();
    await editor(page).press('Enter');
    await expect.poll(() => bodies(bridge, 'media').length, { timeout: 10_000 }).toBe(2);
    expect(bodies(bridge, 'deliver')).toHaveLength(1);
    const second = (bodies(bridge, 'media')[1] as { upload: string }).upload;
    bridge.emit({ type: 'media', id: second, upload: second, index: 0, state: 'forwarded', phase: 'end', attachments: [{ index: 0, state: 'forwarded' }] });
    await expect(fileRow('again.png')).toContainText('Sent to the model', { timeout: 5_000 });
    await expect(fileRow('again.png')).toHaveCount(0, { timeout: 10_000 });
    await expect(fileRow('notes.pdf'), 'a file that did not go on stays until dismissed').toHaveCount(1);
    await uploads.getByRole('button', { name: 'Dismiss' }).click();
    await expect(uploads).toHaveCount(0);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('each control reaches the bridge with its body: the model chip, a slash command, interrupt, compact with instructions, MCP reconnect and enable, a side question answered from its op’s end, and the agent and shell stops', async () => {
    test.setTimeout(150_000);
    const agent = { agentId: 'a1e2e000000000001', description: 'Count the words', prompt: 'Count the words in notes.md.', at: '2026-10-28T10:00:03.000Z' };
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      return [userRecord(sid, cwd, ask, after, 'Count the words in the background.', '2026-10-28T10:00:03.000Z'), ...backgroundAgentRecords(sid, cwd, ask, agent)];
    });
    await backgroundAgentSidecars(c.store, c.sid, c.repo.root, agent);
    const { page } = c;
    const { bridge } = await drive(c);

    // the model chip: the catalog's models, a pick sending only the model
    await main(page).getByRole('button', { name: /^Model / }).click();
    await page.getByRole('button', { name: /· Select model$/ }).click(); // the chip opens on the effort view
    await page.getByRole('menuitemradio', { name: /^sonnet/ }).click();
    await expect.poll(() => bodies(bridge, 'model')).toEqual([{ op: 'model', model: 'sonnet', effort: null }]); // main keeps the effort the bridge holds
    await page.keyboard.press('Escape');
    // the effort on its own: main reads the model fresh and sends it unchanged beside the new effort
    await main(page).getByRole('button', { name: /^Model / }).click();
    await page.getByRole('slider', { name: 'Effort' }).locator('[data-level="high"]').click();
    await expect.poll(() => bodies(bridge, 'model')).toEqual([
      { op: 'model', model: 'sonnet', effort: null },
      { op: 'model', model: 'sonnet', effort: 'high' },
    ]);
    await page.keyboard.press('Escape');

    // a runnable slash command, its outcome from its op's `run` end (each run's id is its argument, as the MCP runs' below)
    bridge.answer('command', (body) => ({ status: 200, body: { ok: true, result: { started: true, id: `run:${String(body.args)}` } } }));
    const ended = (args: string, text: string, name = 'mcp') => bridge.emit({ type: 'run', phase: 'end', id: `run:${args}`, name, readback: { how: 'text', text } });
    await typeAndSend(page, '/rename o9-sitting');
    await expect.poll(() => bodies(bridge, 'command')).toEqual([{ op: 'command', name: 'rename', args: 'o9-sitting' }]);
    ended('o9-sitting', 'Session renamed to o9-sitting.', 'rename');
    await expect(page.getByText('/rename: Session renamed to o9-sitting.', { exact: true })).toBeVisible({ timeout: 10_000 });

    // interrupt, while a turn runs
    bridge.emit({ type: 'turn', phase: 'start', turnId: 'turn-i' });
    const stop = main(page).getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeVisible({ timeout: 10_000 });
    await stop.click();
    await expect.poll(() => bodies(bridge, 'interrupt')).toEqual([{ op: 'interrupt' }]);
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-i' });

    // compact, with the instructions typed after it
    await editor(page).click();
    await editor(page).pressSequentially('/compact keep the file list');
    await editor(page).press('Enter');
    await page.getByRole('button', { name: 'Compact now' }).click();
    await expect.poll(() => bodies(bridge, 'compact')).toEqual([{ op: 'compact', instructions: 'keep the file list' }]);

    // MCP: the bridge's read lists a connected server; Reconnect and Enable run `/mcp <verb> <name>`
    bridge.answer('read', (body) =>
      body.what === 'mcp'
        ? { status: 200, body: { ok: true, result: { exact: false, servers: [{ name: 'probe', status: 'connected', tools: 1 }] } } }
        : { status: 200, body: { ok: true, result: { version: { version: '2.1.300' }, model: 'claude-opus-4-5', cwd: c.repo.root, root: c.repo.root, repo: null, surfaces: [], override: null } } },
    );
    await clear(editor(page));
    await editor(page).pressSequentially('/mcp');
    await editor(page).press('Enter');
    // each run's end (the mod's `run end`) frees the widget for the next; Disable stays in place, closed with the route
    // table's reason (acceptance 2)
    const server = page.locator('[data-mcp-server="probe"]');
    await expect(server.getByRole('button', { name: 'Disable' })).toBeDisabled();
    await expect(server.getByRole('button', { name: 'Disable' })).toHaveAttribute('title', sentence(FULL_CAPABILITIES.controls!['mcp.disable']!.reason!));
    await server.getByRole('button', { name: 'Reconnect' }).click();
    await expect.poll(() => bodies(bridge, 'command').length).toBe(2);
    ended('reconnect probe', 'Reconnected to probe.');
    await expect(page.getByRole('status').filter({ hasText: 'Reconnected to probe.' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('textbox', { name: 'Server to enable' }).fill('github');
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect.poll(() => bodies(bridge, 'command').length).toBe(3);
    ended('enable github', 'Enabled github.');
    await expect.poll(() => bodies(bridge, 'command').slice(1)).toEqual([
      { op: 'command', name: 'mcp', args: 'reconnect probe' },
      { op: 'command', name: 'mcp', args: 'enable github' },
    ]);
    await page.keyboard.press('Escape');

    // a side question, answered from its op's end
    bridge.answer('btw', () => ({ status: 200, body: { ok: true, result: { started: true, id: 'btw-1' } } }));
    await clear(editor(page));
    await typeAndSend(page, '/btw why so short?');
    await expect.poll(() => bodies(bridge, 'btw')).toEqual([{ op: 'btw', prompt: 'why so short?' }]);
    bridge.emit({ type: 'btw', phase: 'start', id: 'btw-1' });
    bridge.emit({ type: 'btw', phase: 'end', id: 'btw-1', text: 'Because you asked for a short one.' });
    await expect(page.getByText('Because you asked for a short one.')).toBeVisible({ timeout: 10_000 });

    // the agents tool: the subagent the transcript started (its sidecars on disk), told through the drill-in's box, then
    // stopped through its Stop (the jobs list's stop has its own scene)
    await openSurface(page, 'Subagents');
    await page.locator('[data-agent-row]').filter({ hasText: agent.description }).click();
    const relay = page.locator('[data-region="panel"] [data-key-sink="composer"]'); // the drill-in's box, not the pane's composer
    await relay.getByRole('textbox', { name: /^Message / }).fill('wrap up');
    await relay.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => bodies(bridge, 'tell')).toEqual([{ op: 'tell', agentId: agent.agentId, text: 'wrap up' }]);
    await page.getByRole('button', { name: 'Stop agent' }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).last().click(); // the confirm
    await expect.poll(() => bodies(bridge, 'stop-agent')).toEqual([{ op: 'stop-agent', agentId: agent.agentId }]);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('the reply streams as it is written, then its row replaces it', async () => {
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);
    const step = { turnId: 'turn-s', agentId: null, step: 0 };
    bridge.emit({ type: 'turn', phase: 'start', turnId: 'turn-s' });
    bridge.emit({ type: 'step', phase: 'start', ...step });
    bridge.emit({ type: 'chunk', ...step, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'Once upon' } });
    bridge.emit({ type: 'chunk', ...step, chunkIndex: 1, chunk: { kind: 'text', index: 0, text: ' a time' } });
    await expect(main(page).getByText('Once upon a time', { exact: true })).toBeVisible({ timeout: 10_000 });

    const row = randomUUID();
    bridge.emit({ type: 'block-row', ...step, uuid: row, index: 0 });
    await c.store.appendLines(c.transcript, [JSON.stringify(assistantRecord(c.sid, c.repo.root, row, randomUUID(), 'Once upon a time, the end.', '2026-10-28T10:01:00.000Z'))]);
    await expect(main(page).getByText('Once upon a time, the end.')).toBeVisible({ timeout: 10_000 });
    await expect(main(page).getByText('Once upon a time', { exact: true }), 'the streamed text left with its row').toHaveCount(0);
    bridge.emit({ type: 'step', phase: 'end', ...step });
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-s' });
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // The M8 sitting: an interrupt's partial reply stays, settled (no longer streaming), as lane B keeps a stopped reply's.
  test('a pane opened mid-reply shows what already streamed; the turn aborting with no step end leaves its text settled, none streaming', async () => {
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c, { open: false });
    const step = { turnId: 'turn-m', agentId: null, step: 0 };
    bridge.emit({ type: 'turn', phase: 'start', turnId: 'turn-m' });
    bridge.emit({ type: 'step', phase: 'start', ...step });
    bridge.emit({ type: 'chunk', ...step, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'Half a story' } });
    await open(c);
    await expect(main(page).getByText('Half a story', { exact: true })).toBeVisible({ timeout: 10_000 });
    bridge.emit({ type: 'chunk', ...step, chunkIndex: 1, chunk: { kind: 'text', index: 0, text: ' and more' } });
    await expect(main(page).getByText('Half a story and more', { exact: true })).toBeVisible({ timeout: 10_000 });
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-m', reason: 'aborted' }); // no step end, no block-row
    await expect(main(page).locator('.transcript-prose-live')).toHaveCount(0, { timeout: 10_000 });
    await expect(main(page).getByText('Half a story and more', { exact: true })).toBeVisible();
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('a permission the bridge raised: Needs you and the pane within 1 s, the hover preview, the Overview card and the badge; allowed here, then answered in the terminal, then a late answer reading who won', async () => {
    test.setTimeout(120_000);
    const c = await begin();
    const { page, maws } = c;
    const { bridge } = await drive(c);
    const sidebar = sidebarOf(page);

    bridge.raise({ request: 'toolu_allow', tool: 'Bash', input: { command: 'ls -la' } });
    await expect(card(page).getByRole('button', { name: 'Allow', exact: true }), 'docked in the pane within 1 s').toBeVisible({ timeout: 1_000 });
    await expect(sidebar.getByRole('heading', { name: 'Needs you · 1' }), 'in Needs you within 1 s').toBeVisible({ timeout: 1_000 });
    await expect(sidebar.getByRole('list', { name: 'Needs you' }).getByRole('button')).toHaveAccessibleName(/ · Approval needed$/);
    await expect(card(page), 'the terminal asks it too (Q3)').toContainText('Also asked in the terminal: the first answer wins');
    await expect.poll(() => badge(maws), 'the dock badge counts it (Q5)').toBe('1');

    // the hover preview and the Overview card show it as any session's
    const row = await sidebarRow(page, { appSessionId: c.appId });
    await expect(row.getByRole('img', { name: 'Needs approval' }), 'its open item wins over the holder glyph (Q1)').toBeVisible();
    const hover = page.locator('[data-hover-card]');
    await expect(async () => {
      await page.mouse.move(700, 20);
      await row.hover();
      await expect(hover).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(hover.getByRole('group', { name: /^Approval needed/ })).toBeVisible();
    await page.mouse.move(700, 20);
    await maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('tab.overview')?.click());
    const overview = main(page).getByRole('dialog', { name: 'Overview' });
    await expect(overview.locator(`[data-card="${await addressed(page, c.appId)}"]`).getByRole('radio', { name: 'Allow once' }), 'the card answers it through the port').toBeVisible({ timeout: 10_000 });
    await overview.getByRole('button', { name: 'Close Overview' }).click();
    await expect(overview).toHaveCount(0);

    // allowed in MAWS: the fake takes Interfaces §D's body; its settle takes the item away within 1 s
    await card(page).getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(() => decided(bridge)).toEqual([{ request: 'toolu_allow', behavior: 'allow', ...AS_MAWS }]);
    bridge.settle('toolu_allow', 'web', 'allow');
    await expect(card(page)).toHaveCount(0, { timeout: 1_000 });
    await expect(sidebar.getByRole('heading', { name: /^Needs you/ })).toHaveCount(0, { timeout: 1_000 });
    await expect.poll(() => badge(maws)).toBe('');

    // answered in the terminal first: the card settles in place as such, stays a moment, then leaves
    bridge.raise({ request: 'toolu_term', tool: 'Bash', input: { command: 'git status' } });
    await expect(card(page).getByRole('button', { name: 'Allow', exact: true })).toBeVisible({ timeout: 1_000 });
    bridge.settle('toolu_term', 'terminal', 'allow');
    await expect(card(page).getByRole('status')).toHaveText('Answered in the terminal: Allowed', { timeout: 2_000 });
    await expect(card(page).getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
    await expect(card(page)).toHaveCount(0, { timeout: 5_000 });

    // an answer the bridge refuses because another won reads as that settlement, never an error
    bridge.raise({ request: 'toolu_late', tool: 'Bash', input: { command: 'rm notes.md' } });
    bridge.answer('decision:toolu_late', () => ({ status: 409, body: { error: 'already settled', settled: { request: 'toolu_late', winner: 'terminal', outcome: 'deny', by: 'terminal' } } }));
    await card(page).getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(card(page).getByRole('status')).toHaveText('Answered in the terminal: Denied', { timeout: 5_000 });
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    expect(decided(bridge).map((d) => d.request), 'the refused one taken by no one').toEqual(['toolu_allow']);
    bridge.settle('toolu_late', 'terminal', 'deny');
    await expect(card(page)).toHaveCount(0, { timeout: 5_000 });
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('a permission card’s options: a scoped allow sends the one suggestion with its destination, two suggestions offer no scope, deny-and-interrupt and an edited input are never sent, a background request past its window is the terminal’s', async () => {
    test.setTimeout(120_000);
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);
    const one = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' };

    bridge.raise({ request: 'toolu_scoped', tool: 'Bash', input: { command: 'npm test' }, suggestions: [one] });
    await card(page).getByRole('radio', { name: 'Allow for this session' }).click();
    await card(page).getByRole('button', { name: 'Allow', exact: true }).click();
    await expect.poll(() => decided(bridge)).toEqual([{ request: 'toolu_scoped', behavior: 'allow', updatedPermissions: [{ ...one, destination: 'session' }], ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_scoped');

    // two suggestions: no scope; deny-and-interrupt closed with its reason; an edited input refused before the bridge
    bridge.raise({ request: 'toolu_two', tool: 'Bash', input: { command: 'npm test' }, suggestions: [one, { ...one, destination: 'session' }] });
    const session = card(page).getByRole('radio', { name: 'Allow for this session' });
    await expect(session).toBeDisabled({ timeout: 5_000 });
    await expect(session).toHaveAttribute('title', "A scoped allow takes the request's one suggestion; this request offers 2");
    await card(page).getByRole('button', { name: 'More deny options' }).click();
    const stop = page.getByRole('menuitem', { name: 'Deny and stop the turn' });
    await expect(stop).toHaveAttribute('aria-disabled', 'true');
    await expect(stop).toHaveAttribute('title', 'Deny-and-interrupt is answered in the terminal');
    await page.keyboard.press('Escape');
    const edited = value(await invoke(page, 'laneA.answer', { appSessionId: c.appId, request: 'toolu_two', answer: { kind: 'permission', decision: 'allow', scope: 'once', updatedInput: { command: 'npm test -- --watch' } } }));
    expect(edited, 'no MAWS control edits an input; the port refuses one').toEqual({ outcome: 'refused', code: 'unsupported', message: 'an edited input is answered in the terminal' });
    await card(page).getByRole('button', { name: 'Deny', exact: true }).click();
    await expect.poll(() => decided(bridge).slice(1)).toEqual([{ request: 'toolu_two', behavior: 'deny', ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_two', 'deny');

    // a background subagent's request: answerable in its window, the terminal's once it closes
    bridge.raise({ request: 'toolu_bg', tool: 'Bash', input: { command: 'make' }, agentId: 'a1e2e000000000002', deadline: Date.now() + 4_000 });
    const allow = card(page).getByRole('button', { name: 'Allow', exact: true });
    await expect(allow).toBeEnabled({ timeout: 1_000 });
    await expect(card(page).getByText('Answer this in the terminal')).toBeVisible({ timeout: 8_000 });
    for (const name of ['Allow', 'Deny']) {
      const button = card(page).getByRole('button', { name, exact: true });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('title', 'Answer this in the terminal');
    }
    expect(decided(bridge)).toHaveLength(2);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('questions and plans: answers, a native question skipped as a decline, an async one answered and never skipped; a plan implemented, kept with feedback and without, its clear and implement closed', async () => {
    test.setTimeout(150_000);
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);
    const asked = (question: string, labels: string[]) => ({ questions: [{ question, header: question.slice(0, 8), options: labels.map((label) => ({ label })), multiSelect: false }] });
    const pick = async (question: string, label: string) => card(page).getByRole('radiogroup', { name: question }).getByRole('radio', { name: label }).click();
    let n = 0;
    const lastDecision = () => decided(bridge).slice(n);

    bridge.raise({ request: 'toolu_q1', tool: 'AskUserQuestion', input: asked('Which colour?', ['Red', 'Blue']) });
    await pick('Which colour?', 'Red');
    await card(page).getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(lastDecision).toEqual([{ request: 'toolu_q1', behavior: 'allow', updatedInput: { answers: { 'Which colour?': 'Red' } }, ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_q1');
    n = 1;

    // every question skipped on a native question: the request declined
    bridge.raise({ request: 'toolu_q2', tool: 'AskUserQuestion', input: asked('Which size?', ['Small', 'Large']) });
    await card(page).getByRole('button', { name: 'Skip', exact: true }).click();
    await expect.poll(lastDecision).toEqual([{ request: 'toolu_q2', behavior: 'deny', ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_q2', 'deny');
    n = 2;

    // an async question (the ask mod's): its Skip closed, its answer sent
    bridge.raise({ request: 'toolu_q3', tool: 'mcp__plugin_sminos_ask__ask', async: true, input: asked('Ship it?', ['Yes', 'Not yet']) });
    const skip = card(page).getByRole('button', { name: 'Skip', exact: true });
    await expect(skip).toBeDisabled({ timeout: 5_000 });
    await expect(skip).toHaveAttribute('title', 'An async question needs an answer');
    await pick('Ship it?', 'Yes');
    await card(page).getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(lastDecision).toEqual([{ request: 'toolu_q3', behavior: 'allow', updatedInput: { answers: { 'Ship it?': 'Yes' } }, ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_q3');
    n = 3;

    // a plan: clear and implement closed with its reason; Implement allows
    const plan = { plan: '1. Write the tests.\n2. Ship.' };
    bridge.raise({ request: 'toolu_p1', tool: 'ExitPlanMode', input: plan });
    const clear = card(page).getByRole('button', { name: 'Clear context and implement' });
    await expect(clear).toBeDisabled({ timeout: 5_000 });
    await expect(clear).toHaveAttribute('title', '/clear runs in the terminal');
    await card(page).getByRole('button', { name: 'Implement', exact: true }).click();
    await expect.poll(lastDecision).toEqual([{ request: 'toolu_p1', behavior: 'allow', ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_p1');
    n = 4;

    // keep planning, with feedback (its message) and without (no message key)
    for (const [request, feedback] of [['toolu_p2', 'Smaller steps, please.'], ['toolu_p3', '']] as const) {
      bridge.raise({ request, tool: 'ExitPlanMode', input: plan });
      await card(page).getByRole('button', { name: 'Keep planning' }).click();
      if (feedback !== '') await card(page).getByRole('textbox', { name: 'What should change in the plan' }).fill(feedback);
      await card(page).getByRole('button', { name: 'Send feedback' }).click();
      await expect.poll(lastDecision).toEqual([{ request, behavior: 'deny', ...(feedback !== '' && { message: feedback }), ...AS_MAWS }]);
      await settledHere(page, bridge, request, 'deny');
      n += 1;
    }
    expect(c.maws.consoleErrors()).toEqual([]);
  });
});
