import { createXlsxViewer, setWasmSource } from '@extend-ai/react-xlsx/vanilla';

// The engine from the page's own host (the condition's `setWasmSource(<own-host URL>)`).
setWasmSource(new URL('duke_sheets_wasm_bg.wasm', import.meta.url).href);

export async function draw(root, bytes) {
  const viewer = createXlsxViewer(root, { file: bytes, fileName: 'sample.xlsx', useWorker: false, readOnly: true, height: 560 });
  const state = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('xlsx: no workbook within 20 s')), 20000);
    const off = viewer.subscribe((c) => {
      if (c.error) { clearTimeout(timer); off?.(); reject(c.error instanceof Error ? c.error : new Error(String(c.error))); }
      else if (!c.isLoading && c.sheets.length > 0) { clearTimeout(timer); resolve({ sheets: c.sheets.map((s) => s.name), active: c.activeSheet?.name ?? null }); }
    });
  });
  await new Promise((r) => setTimeout(r, 1500)); // lazy pieces (fonts, charts) land
  return { ...state, text: root.innerText.length, nodes: root.querySelectorAll('*').length, canvases: root.querySelectorAll('canvas').length };
}
