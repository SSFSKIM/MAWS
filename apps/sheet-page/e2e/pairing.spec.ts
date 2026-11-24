// The page's shell and its pairing, in a browser (§P, M2; A.a; T19, T28): the link of the terminal's form, opened in a
// browser that never paired, shows the pairing screen and asks nothing of the server; the code `mawsd sheet pair` prints
// pairs it and the place asked for shows; the pairing holds across a reload and is the browser's own; Unpair forgets
// every key and is told to mawsd; and nothing the page loads comes from outside it.
import { BAR, expect, SESSION, storedKeys, test, violationsOf } from './fixtures';

test('a browser that never paired is shown the pairing screen at the link, and makes no request and opens no socket', async ({ page, mawsd }) => {
  const requests: string[] = [];
  const sockets: string[] = [];
  page.on('request', (request) => void requests.push(request.url()));
  page.on('websocket', (socket) => void sockets.push(socket.url()));
  await page.goto(`${mawsd.url}/s/${SESSION}`);
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
  await expect(page.getByText('mawsd sheet pair', { exact: true })).toBeVisible();
  await expect(page.getByTestId('unpaired')).toHaveCount(0); // a first visit
  await expect(page.getByRole('button', { name: 'Pair', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Then type the code it prints:')).toBeFocused();
  await page.waitForTimeout(1_500); // a connection would have been tried by now
  expect(requests.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([]);
  expect(sockets).toEqual([]);
  expect(page.url()).toBe(`${mawsd.url}/s/${SESSION}`);
  await expect(page).toHaveTitle('Sheet');
});

test('the code pairs the browser and the place asked for shows; a wrong code says how many tries are left; a reload stays paired; another browser is not paired by it', async ({ page, browser, mawsd }) => {
  await page.goto(`${mawsd.url}/s/${SESSION}`);
  const field = page.getByLabel('Then type the code it prints:');
  await field.fill('aaaa0000'); // written upper case, the dash shown by the field
  await expect(field).toHaveValue('AAAA-0000');
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('That code has expired. Run the command again.'); // none is live yet

  const { out } = await mawsd.cli('sheet', 'pair');
  const code = out.split('\n')[0]!;
  const wrong = code.slice(0, 8) + (code.at(-1) === '0' ? '1' : '0');
  await field.fill(wrong);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('That code is not right. 4 tries left.');
  await expect(field).toHaveValue(wrong); // the code stays in the field

  await field.fill(code);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  const bar = page.getByRole(BAR);
  await expect(bar).toBeVisible();
  await expect(page).toHaveURL(`${mawsd.url}/s/${SESSION}`);
  await expect(bar.getByRole('link', { name: 'All sessions' })).toHaveAttribute('href', '/');
  await expect(bar.getByRole('button', { name: 'Show questions' })).toBeVisible();
  expect(await storedKeys(page)).toEqual(['maws.sheet.credential']);

  await page.reload();
  await expect(page.getByRole(BAR)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toHaveCount(0);

  await page.getByRole('link', { name: 'All sessions' }).click();
  await expect(page).toHaveURL(`${mawsd.url}/`);
  await expect(page.getByRole(BAR).getByText('This Mac')).toBeVisible();
  await expect(page.getByRole(BAR).getByRole('button', { name: 'Show questions' })).toHaveCount(0); // a session's sheet only

  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto(`${mawsd.url}/`);
  await expect(second.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
  expect(await storedKeys(second)).toEqual([]);
  await other.close();
  expect(await mawsd.browsers()).toHaveLength(1);
});

test('“Unpair this browser” clears every key under maws.sheet., shows the pairing screen, and mawsd no longer lists it', async ({ page, mawsd }) => {
  await page.goto(`${mawsd.url}/`);
  await mawsd.pair(page);
  expect(await mawsd.browsers()).toHaveLength(1);
  await page.evaluate(() => localStorage.setItem('maws.sheet.draft.s.q1', '{}')); // what M4's memory keeps beside it
  await page.getByRole(BAR).getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Unpair this browser' }).click();
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
  await expect(page.getByTestId('unpaired')).toHaveText('This browser is not paired.'); // revoked, and saved
  expect(await storedKeys(page)).toEqual([]);
  expect(await mawsd.browsers()).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeVisible();
});

test('nothing from outside: every request the pairing screen and the frame made is the page’s own, and no content policy was violated', async ({ page, context, mawsd }) => {
  const violations = await violationsOf(context);
  const consoleSays: string[] = [];
  page.on('console', (message) => void consoleSays.push(message.text()));
  const requests: string[] = [];
  page.on('request', (request) => void requests.push(request.url()));
  const sockets: string[] = [];
  page.on('websocket', (socket) => void sockets.push(socket.url()));
  await page.goto(`${mawsd.url}/s/${SESSION}`);
  await mawsd.pair(page);
  await page.getByRole(BAR).getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Unpair this browser' })).toBeVisible();
  await page.keyboard.press('Escape');
  const beforeReload = await violations();
  await page.reload();
  await expect(page.getByRole(BAR)).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  for (const url of requests) expect(new URL(url).origin, url).toBe(mawsd.url);
  expect(sockets.length).toBeGreaterThan(0);
  for (const url of sockets) expect(url).toBe(`ws://sheet.localhost:${mawsd.port}/live`);
  expect([...beforeReload, ...(await violations())]).toEqual([]);
  expect(consoleSays.filter((text) => /Content Security Policy/i.test(text))).toEqual([]);
});
