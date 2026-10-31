// P5 O5 M3 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M3 "One library, two roots, one registration rule"):
// the render library composed under a stand-in for each of its roots answers alike. The embedded root's `call` is main's
// host dispatch narrowed to the engine host (a `CommandResult` straight from the host); the render host's is its
// `machine.sock` client's `invoke` through the typed adapter (a `HostResponse` turned into one). Both serve the same
// exporter registry, kind by kind and format by format, and the library's export of a document writes the same file
// through either; `composeRender` registers nothing on IPC, and its `stop` withdraws every exporter.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import { newDoc, stateV2 } from '@artifacts/yjs';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import { ipcError } from '@shared/ipc/errors';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { ARTIFACT_EXPORT_FORMATS } from '@shared/maws/tools';
import { hostCall } from '../render-host/client';
import { composeRender, type HostCall, type Render } from './compose';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

const DOC = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';

function documentState(): Uint8Array {
  const doc = newDoc();
  const schema = schemaFor();
  createDocument(doc, { title: 'Overview', body: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1aaaaaa' }, content: [{ type: 'text', text: 'Both roots export this line.' }] }] }) });
  const state = stateV2(doc);
  doc.destroy();
  return state;
}

// The engine host both roots reach: a document at revision 4 under the bundled design system
function engineHost(): (name: string) => CommandResult<CommandName> {
  const state = documentState();
  return (name) => {
    switch (name) {
      case 'artifacts.get':
        return { ok: true, value: { artifact: { id: DOC, kind: 'document', title: 'Plan', revision: 4 } } } as never;
      case 'artifacts.state':
        return { ok: true, value: { bytes: state, revision: 4 } } as never;
      case 'designSystems.governing':
        return { ok: true, value: { system: { builtin: true } } } as never;
      default:
        return { ok: false, error: ipcError('host_unavailable', `the stand-in engine host answers no ${name}`) };
    }
  };
}

let root: string | null = null;
const composed: Render[] = [];
afterEach(() => {
  for (const render of composed.splice(0)) render.stop();
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

function roots(): { embedded: Render; renderHost: Render } {
  root = mkdtempSync(join(tmpdir(), 'maws-compose-'));
  const host = engineHost();
  // main's embedded root: hosts.dispatch('engine-host', …) narrowed, a CommandResult as the host answered it
  const embeddedCall: HostCall = async (name, input) => (void input, host(name)) as never;
  // the render host's: machine.sock's HostResponse through the typed adapter
  const invoke = async (name: string): Promise<HostResponse> => {
    const result = host(name);
    return result.ok ? { t: 'res', id: 'r', ok: true, value: result.value } : { t: 'res', id: 'r', ok: false, error: result.error };
  };
  const renderHostCall = hostCall(invoke);
  const make = (call: HostCall) => {
    const render = composeRender({ call, content: (input) => call('artifacts.content', input), root: root!, env: {} });
    composed.push(render);
    return render;
  };
  return { embedded: make(embeddedCall), renderHost: make(renderHostCall) };
}

const servable = (render: Render) => ARTIFACT_KINDS.flatMap((kind) => ARTIFACT_EXPORT_FORMATS.filter((format) => render.exporters.get(kind, format) !== undefined).map((format) => `${kind}/${format}`));

describe('composeRender under both roots', () => {
  it('serves the same exporter registry under the embedded root and the render host', () => {
    const { embedded, renderHost } = roots();
    expect(servable(renderHost)).toEqual(servable(embedded));
    expect(servable(embedded).sort()).toEqual(
      ['dashboard/docx', 'dashboard/html', 'dashboard/md', 'dashboard/pdf', 'design/pdf', 'design/png', 'design_system/claude', 'document/docx', 'document/html', 'document/md', 'document/pdf', 'document/png', 'html/pdf', 'html/png', 'presentation/claude', 'presentation/html', 'presentation/pdf', 'presentation/png', 'presentation/pngs', 'presentation/pptx'].sort(),
    );
  });

  it('writes the same file for the library’s export through either root’s call', async () => {
    const { embedded, renderHost } = roots();
    const a = await embedded.exportForLibrary({ artifactId: DOC, format: 'md', ownFile: true });
    const b = await renderHost.exportForLibrary({ artifactId: DOC, format: 'md', ownFile: true });
    expect([a.revision, b.revision]).toEqual([4, 4]);
    expect(readFileSync(b.path, 'utf8')).toBe(readFileSync(a.path, 'utf8'));
    expect(readFileSync(a.path, 'utf8')).toContain('Both roots export this line.');
    expect(a.path.startsWith(join(root!, DOC, 'exports'))).toBe(true);
  });

  it('answers the library’s refusal alike, and withdraws every exporter at stop', async () => {
    const { embedded, renderHost } = roots();
    for (const render of [embedded, renderHost]) {
      await expect(render.exportForLibrary({ artifactId: DOC, format: 'pptx' })).rejects.toMatchObject({ ipcError: { code: 'invalid_input', issues: { reason: 'exportUnavailable', data: { kind: 'document', format: 'pptx' } } } });
    }
    embedded.stop();
    expect(servable(embedded)).toEqual([]);
    expect(servable(renderHost)).not.toEqual([]);
  });
});
