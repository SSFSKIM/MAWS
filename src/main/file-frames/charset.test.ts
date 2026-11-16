// An HTML page's Content-Type from its head (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// decision 18; M3, decision 11): UTF-8 is said only when the head holds no byte-order mark, declares no charset, and is
// valid UTF-8; otherwise the type goes out as it always has and Chromium decides. Every page here is invented.
import { describe, expect, it } from 'vitest';
import { FRAME_HEAD_BYTES, htmlContentType } from './charset';

const UTF8 = 'text/html; charset=utf-8';
const BARE = 'text/html';
const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));
const PAGE = '<!doctype html><html><head><title>Déjà vu — 회의</title></head><body><p>Ünïcödé text, curly “quotes”.</p></body></html>';

describe('htmlContentType', () => {
  it('valid UTF-8 with no mark and no declaration is UTF-8', () => {
    expect(htmlContentType(bytes(PAGE))).toBe(UTF8);
  });

  it('plain ASCII is UTF-8', () => {
    expect(htmlContentType(bytes('<!doctype html><p>plain words</p>'))).toBe(UTF8);
    expect(htmlContentType(new Uint8Array())).toBe(UTF8);
  });

  it('a UTF-8 or a UTF-16 byte-order mark leaves the type as it is', () => {
    expect(htmlContentType(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(PAGE)]))).toBe(BARE);
    expect(htmlContentType(new Uint8Array([0xfe, 0xff, 0x00, 0x3c]))).toBe(BARE);
    expect(htmlContentType(new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))).toBe(BARE);
  });

  it.each([
    '<meta charset="utf-8">',
    '<META CHARSET=windows-1252>',
    "<meta charset='euc-kr' />",
    '<Meta Http-Equiv="Content-Type" Content="text/html; Charset=ISO-8859-1">',
    '<meta content="text/html; charset=shift_jis" http-equiv="content-type">',
    "<meta http-equiv='CONTENT-TYPE' content='text/html;charset=koi8-r'>",
  ])('a meta charset, in any case and either form, leaves the type as it is: %s', (meta) => {
    expect(htmlContentType(bytes(`<!doctype html><html><head>${meta}<title>t</title></head><body>plain</body></html>`))).toBe(BARE);
  });

  it('a meta element that declares no charset is no declaration', () => {
    expect(htmlContentType(bytes('<head><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="5"></head>'))).toBe(UTF8);
    expect(htmlContentType(bytes('<head><meta http-equiv="content-type" content="text/html"></head>'))).toBe(UTF8);
    expect(htmlContentType(bytes('<head><meta name="description" content="about charset=nothing"></head>'))).toBe(UTF8);
  });

  // Decision Log 31: comments are skipped as the HTML standard's encoding prescan skips them, from `<!--` to the first `>`
  // preceded by `--` after the opening `<`, an unterminated one running to the head's end.
  it('a UTF-8 head whose only meta charset is inside a comment is served as UTF-8', () => {
    expect(htmlContentType(bytes(`<!doctype html><html><head><!-- <meta charset="windows-1252"> --><title>t</title></head><body>${PAGE}</body></html>`))).toBe(UTF8);
    expect(htmlContentType(bytes('<head><!--\n<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">\n--></head><p>Déjà vu</p>'))).toBe(UTF8);
    expect(htmlContentType(bytes('<head><!-- a -- b > c <meta charset="euc-kr"> --></head><p>회의</p>'))).toBe(UTF8); // the `>` after ` b ` is not preceded by `--`
  });

  it('a real declaration after a comment is still a declaration', () => {
    expect(htmlContentType(bytes('<head><!-- the old one: <meta charset="utf-8"> --><meta charset="windows-1252"></head><p>plain</p>'))).toBe(BARE);
    expect(htmlContentType(bytes('<head><!--><meta charset="windows-1252"></head><p>plain</p>'))).toBe(BARE); // `<!-->` is a whole comment
    expect(htmlContentType(bytes('<head><!---><meta charset="windows-1252"></head><p>plain</p>'))).toBe(BARE); // and so is `<!--->`
    expect(htmlContentType(bytes('<head><meta name="note" content="<!--" charset="windows-1252"></head><p>plain</p>'))).toBe(BARE); // inside a tag's quoted value, no comment
  });

  it('an unterminated comment before a meta leaves none', () => {
    expect(htmlContentType(bytes('<head><!-- never closed <meta charset="windows-1252"></head><p>Déjà vu</p>'))).toBe(UTF8);
    expect(htmlContentType(bytes('<head><!-- closed only by -> <meta charset="windows-1252"></head><p>plain</p>'))).toBe(UTF8);
  });

  // The coordinator's finding A (Decision Log 31): another tag is read whole, its attributes as the prescan reads them, so a
  // `<!--` or a `<meta` inside a quoted value is neither a comment nor a declaration.
  it('a comment opener inside another tag’s quoted value opens no comment, and a meta after it declares a charset', () => {
    expect(htmlContentType(bytes('<html data-marker="<!--"><head><meta charset="windows-1252"></head><p>plain</p>'))).toBe(BARE);
    expect(htmlContentType(bytes("<html data-marker='<!--'><head><meta charset=\"windows-1252\"></head><p>plain</p>"))).toBe(BARE);
    expect(htmlContentType(bytes('<head><body title="x > <!-- y"><meta charset="windows-1252"><p>plain</p>'))).toBe(BARE); // a `>` inside the quoted value
    expect(htmlContentType(bytes('<?xml version="1.0" note="<!--"?><head><meta charset="windows-1252"></head><p>plain</p>'))).toBe(BARE); // `<?` skips to its `>`
  });

  it('a meta inside another tag’s quoted value is no declaration', () => {
    expect(htmlContentType(bytes('<head><div title="<meta charset=windows-1252>"></div></head><p>Déjà vu</p>'))).toBe(UTF8);
    expect(htmlContentType(bytes("<head><a href='x' title='a > <meta charset=euc-kr>'>x</a></head><p>회의</p>"))).toBe(UTF8);
  });

  it('a byte that is not valid UTF-8 leaves the type as it is', () => {
    const latin1 = new Uint8Array(Buffer.from('<p>caf\xe9 cr\xe8me</p>', 'latin1'));
    expect(htmlContentType(latin1)).toBe(BARE);
    expect(htmlContentType(new Uint8Array([0x3c, 0x70, 0x3e, 0xc0, 0xaf, 0x3c]))).toBe(BARE); // an overlong form
    expect(htmlContentType(new Uint8Array([0x3c, 0xed, 0xa0, 0x80, 0x3e]))).toBe(BARE); // a surrogate's encoding
  });

  it('a sequence cut short at the end of the read is not invalid', () => {
    const whole = bytes(`${PAGE}회`);
    expect(htmlContentType(whole.subarray(0, whole.length - 1))).toBe(UTF8); // two of the three bytes of 회
    expect(htmlContentType(whole.subarray(0, whole.length - 2))).toBe(UTF8);
    // cut short, yet already invalid: a lead byte followed by a byte that cannot continue it
    expect(htmlContentType(new Uint8Array([0x3c, 0xe0, 0x41]))).toBe(BARE);
  });

  it('a declaration past the bound is not seen: the recorded limit', () => {
    // a page in another encoding whose first 64 KiB are plain ASCII and declare nothing is sent as UTF-8
    const page = Buffer.concat([Buffer.from(`<!doctype html><body>${'a'.repeat(FRAME_HEAD_BYTES)}`, 'latin1'), Buffer.from('<meta charset="windows-1252"><p>caf\xe9</p>', 'latin1')]);
    expect(htmlContentType(new Uint8Array(page.subarray(0, FRAME_HEAD_BYTES)))).toBe(UTF8);
    expect(htmlContentType(new Uint8Array(page))).toBe(BARE); // the whole page would have said so
  });
});
