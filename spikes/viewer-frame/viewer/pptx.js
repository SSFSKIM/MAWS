import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';

export async function draw(root, bytes) {
  await PptxViewer.open(bytes, root, { zipLimits: RECOMMENDED_ZIP_LIMITS, pdfjs: false });
  return { text: root.innerText.length, nodes: root.querySelectorAll('*').length, svgs: root.querySelectorAll('svg').length };
}
