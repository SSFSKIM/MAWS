// A picture's pixel size from its header, for the DOCX export (Word needs an image's extent): PNG, GIF, BMP and JPEG,
// the raster formats `docx` embeds. Null for anything else or a truncated header.
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (offset: number, length: number) => offset + length <= bytes.length;
  // PNG: the IHDR chunk follows the 8-byte signature
  if (at(0, 24) && view.getUint32(0) === 0x89504e47 && view.getUint32(12) === 0x49484452) return { width: view.getUint32(16), height: view.getUint32(20) };
  // GIF: the logical screen, little-endian
  if (at(0, 10) && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  // BMP: the DIB header's width and height (a negative height is top-down)
  if (at(0, 26) && bytes[0] === 0x42 && bytes[1] === 0x4d) return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  // JPEG: the first start-of-frame marker's height and width
  if (at(0, 4) && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (at(offset, 9)) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      offset += 2 + length;
    }
  }
  return null;
}
