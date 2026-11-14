import { renderAsync } from 'docx-preview';

export async function draw(root, bytes) {
  await renderAsync(bytes, root, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true, experimental: false, useBase64URL: false });
  return { text: root.innerText.length, nodes: root.querySelectorAll('*').length };
}
