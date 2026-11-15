// The spike's PDFs, built from text (invented content, nothing read from disk): a writer of objects with a cross-reference
// table, and the documents rows a, b, e, h and i load.
const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
const str = (s) => `(${esc(s)})`;

function writer() {
  const objects = [];
  return {
    add(body) {
      objects.push(body);
      return objects.length;
    },
    set(ref, body) {
      objects[ref - 1] = body;
    },
    reserve() {
      objects.push(null);
      return objects.length;
    },
    stream(dict, data) {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
      return this.add({ dict: `<< ${dict} /Length ${bytes.length} >>`, bytes });
    },
    finish(root) {
      const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
      let at = parts[0].length;
      const offsets = [];
      objects.forEach((body, i) => {
        offsets.push(at);
        const chunk = typeof body === 'string'
          ? Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1')
          : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${body.dict}\nstream\n`, 'latin1'), body.bytes, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
        parts.push(chunk);
        at += chunk.length;
      });
      const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
      parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R >>\nstartxref\n${at}\n%%EOF\n`, 'latin1'));
      return Buffer.concat(parts);
    },
  };
}

// Deterministic noise for the large document's pictures (xorshift32), so its bytes do not compress away.
function noise(length, seed) {
  const out = Buffer.alloc(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

// pages: [{ lines: string[], image?: { width, height, seed }, annots?: (w, pageRef) => string[] }]
// catalog: (w, pageRefs) => extra catalog entries
export function buildPdf({ pages, catalog = () => '' }) {
  const w = writer();
  const font = w.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesRef = w.reserve();
  const pageRefs = pages.map(() => w.reserve());
  pages.forEach((page, i) => {
    let content = 'BT /F1 28 Tf 72 740 Td ';
    page.lines.forEach((line, j) => {
      content += `${j ? '0 -36 Td ' : ''}${str(line)} Tj `;
    });
    content += 'ET\n';
    let xobjects = '';
    if (page.image) {
      const { width, height, seed } = page.image;
      const im = w.stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8`, noise(width * height * 3, seed));
      xobjects = `/XObject << /Im1 ${im} 0 R >>`;
      content += `q 468 0 0 400 72 220 cm /Im1 Do Q\n`;
    }
    const contents = w.stream('', content);
    const annots = page.annots ? page.annots(w, pageRefs[i]) : [];
    w.set(pageRefs[i], `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> ${xobjects} >> /Contents ${contents} 0 R${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : ''} >>`);
  });
  w.set(pagesRef, `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const root = w.add(`<< /Type /Catalog /Pages ${pagesRef} 0 R ${catalog(w, pageRefs)} >>`);
  return w.finish(root);
}

const textPages = (n, title) => Array.from({ length: n }, (_, i) => ({ lines: [`${title}`, `Page ${i + 1} of ${n}`, 'Invented text for the file-frame spike.'] }));

// Row a and row b: several pages, about 5 MiB (a picture of noise on each page).
export const largePdf = () => buildPdf({ pages: Array.from({ length: 5 }, (_, i) => ({ lines: ['Large document', `Page ${i + 1} of 5`], image: { width: 640, height: 540, seed: 1000 + i } })) });

// Rows h and i: several pages of text.
export const pagesPdf = () => buildPdf({ pages: textPages(6, 'Several pages') });

const js = (code) => `<< /S /JavaScript /JS ${str(code)} >>`;
const openAction = (action) => () => `/OpenAction ${action}`;

// A text field "f" on the first page, with the AcroForm that names it.
function withField(extra) {
  let field;
  return {
    annots: (w, pageRef) => {
      field = w.add(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (f) /V (empty) /Rect [72 500 400 530] /P ${pageRef} 0 R /F 4 /DA (/Helv 14 Tf 0 g) >>`);
      return [field];
    },
    catalog: (w) => `/AcroForm << /Fields [${field} 0 R] /NeedAppearances true /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >> ${extra(w)}`,
  };
}

// Row e: one document per behaviour, each acting by itself when it opens (no click), and two controls that show
// whether the viewer runs a document's actions at all (a script that moves to page 3, an action that does the same).
export function hostilePdfs() {
  const one = (title, catalog, pages = textPages(1, title)) => buildPdf({ pages, catalog });
  const form = withField(() => `/OpenAction << /S /SubmitForm /F << /FS /URL /F (https://example.com/submit-action) >> /Flags 4 /Next ${js('this.submitForm("https://example.com/submit-script");')} >>`);
  const formPages = textPages(1, 'Form submit');
  formPages[0].annots = form.annots;
  let attachment;
  return {
    'baseline': one('Baseline', () => ''),
    'control-script': one('Control: script', openAction(js('this.pageNum = 2;')), textPages(3, 'Control: script')),
    'control-action': buildPdf({ pages: textPages(3, 'Control: action'), catalog: (w, refs) => `/OpenAction [${refs[2]} 0 R /Fit]` }),
    'alert': one('Alert', openAction(js('app.alert("Invented alert from the spike");'))),
    'print': one('Print', openAction(js('this.print();'))),
    'submit': buildPdf({ pages: formPages, catalog: form.catalog }),
    'launch': one('Launch', openAction('<< /S /Launch /F (spike-launch-target.sh) /NewWindow true >>')),
    'goto-other-relative': one('Go to another file, relative', openAction('<< /S /GoToR /F (other.pdf) /D [0 /Fit] >>')),
    'goto-other-absolute': one('Go to another file, absolute', openAction('<< /S /GoToR /F << /Type /Filespec /F (/tmp/file-frame-other.pdf) /UF (/tmp/file-frame-other.pdf) >> /D [0 /Fit] >>')),
    'uri-action': one('A link action', openAction('<< /S /URI /URI (https://example.com/uri-action) >>')),
    'uri-script': one('A link by script', openAction(js('app.launchURL("https://example.com/launch-url", true);'))),
    'attachment': buildPdf({
      pages: textPages(1, 'Attachment'),
      catalog: (w) => {
        const ef = w.stream('/Type /EmbeddedFile /Subtype /text#2Fplain', 'Invented attachment text.\n');
        attachment = w.add(`<< /Type /Filespec /F (note.txt) /UF (note.txt) /EF << /F ${ef} 0 R >> >>`);
        return `/Names << /EmbeddedFiles << /Names [(note.txt) ${attachment} 0 R] >> >> /OpenAction ${js('this.exportDataObject({ cName: "note.txt", nLaunch: 2 });')}`;
      },
    }),
  };
}
