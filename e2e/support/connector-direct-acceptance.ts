// P3-HD M4b: what route D's two built-app spec files (e2e/connectors-direct.spec.ts and e2e/connectors-oauth.spec.ts, the
// connectors-direct and connectors-oauth groups) share: the evidence each prints to the job's log as well as attaching
// it, and the owner's gestures on H's Connectors sheet (Allow, Allow once, Revoke), the owner's session stopped, and a
// screenshot of a sheet.
import { createHash } from 'node:crypto';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { CONNECTORS_COPY as C } from '../../src/renderer/src/tools/artifacts/viewers/connectors/copy';
import { invoke as appInvoke, value as appValue, TOOL_NAME, type ConnectorScene, type LiveEngine, type Run } from './connector-scene';

// Until the gate keeps a passing job's artifacts, each file is also printed to the job's log between markers (fixture
// values only: every path scrubbed, every value a fake the probe wrote).
export function printEvidence(label: string, body: string): void {
  const bytes = Buffer.from(body, 'utf8');
  const lines = bytes.toString('base64').match(/.{1,1000}/g) ?? [];
  process.stdout.write(`MAWS-CONNECTORS-DIRECT-EVIDENCE BEGIN ${label} bytes=${bytes.length} sha256=${createHash('sha256').update(bytes).digest('hex')}\n${lines.join('\n')}\nMAWS-CONNECTORS-DIRECT-EVIDENCE END ${label}\n`);
}

export async function evidence(info: TestInfo, label: string, value: unknown): Promise<void> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await info.attach(`${label}.json`, { body, contentType: 'application/json' });
  printEvidence(`${label}.json`, body);
}

export const toolRowOf = (sheet: Locator, name = TOOL_NAME) => sheet.locator(`[data-connector-tool="${name}"]`);
export const grantsOf = async (page: Page, artifactId: string) => appValue(await appInvoke(page, 'artifacts.connectorGrants', { artifactId })).grants;

export async function allow(scene: ConnectorScene, page: Page, name: string, mode: 'read' | 'once' = 'read'): Promise<void> {
  const sheet = await scene.openSheet(page);
  await toolRowOf(sheet, name).getByRole('button', { name: mode === 'read' ? C.allowLabel(name) : C.allowOnceLabel(name) }).click();
  await expect(toolRowOf(sheet, name).locator('[data-connector-state]')).toContainText(mode === 'read' ? C.allowedRead : C.allowedOnce);
  await scene.closeSheet(page);
}

export async function revokeInSheet(scene: ConnectorScene, page: Page, name = TOOL_NAME): Promise<void> {
  const sheet = await scene.openSheet(page);
  await toolRowOf(sheet, name).getByRole('button', { name: C.revokeLabel(name) }).click();
  await expect(toolRowOf(sheet, name).locator('[data-connector-state]')).toContainText(C.notAllowed);
  await scene.closeSheet(page);
}

// The owner's session stopped, its process gone and no engine live.
export async function stopEngine(scene: ConnectorScene, run: Run, engine: LiveEngine): Promise<void> {
  appValue(await appInvoke(run.page, 'session.stop', { appSessionId: engine.appSessionId, reason: 'stop' }));
  await expect.poll(() => scene.pidAlive(engine.pid), { timeout: 30_000, message: 'the engine stopped' }).toBe(false);
  expect(await scene.live(run.page), 'no engine is live').toEqual([]);
}

export async function shot(info: TestInfo, name: string, target: Locator): Promise<void> {
  await info.attach(name, { body: await target.screenshot(), contentType: 'image/png' });
}
