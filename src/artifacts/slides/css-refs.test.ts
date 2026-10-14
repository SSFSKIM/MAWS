// P3-C M1 fix wave 3: the references CSS text makes, read as CSS Syntax §4 tokenizes it, not by its spelling.
import { describe, expect, it } from 'vitest';
import { cssRefs } from './css-refs';

const urls = (css: string) => cssRefs(css).map((r) => (r.kind === 'url' ? r.value : r.kind === 'image-function' ? `${r.name}()` : r.kind));

describe('cssRefs', () => {
  it('reads unquoted and quoted urls', () => {
    expect(urls('a{fill:url(#g); stroke:URL( "#h" ); filter:url(\'#f\')}')).toEqual(['#g', '#h', '#f']);
  });

  it('reads escapes and line continuations as CSS does', () => {
    expect(urls('a{fill:url("https://example.com/\\\na.svg#g")}')).toEqual(['https://example.com/a.svg#g']);
    expect(urls('a{fill:url("https://example.com/\\\r\na.svg")}')).toEqual(['https://example.com/a.svg']);
    expect(urls('a{fill:u\\72l(https://x.test/a)}')).toEqual(['https://x.test/a']);
    expect(urls('a{fill:\\75 rl(https://x.test/a)}')).toEqual(['https://x.test/a']);
    expect(urls('a{fill:url(\\68ttps://x.test/a)}')).toEqual(['https://x.test/a']);
    expect(urls("a{fill:url('#\\67')}")).toEqual(['#g']);
  });

  it('skips comments and does not read a url inside a string or a comment', () => {
    expect(urls('/* url(https://x.test/a) */ a{content:"url(https://x.test/b)"; fill:u/**/rl(#g)}')).toEqual([]);
    expect(urls('a{fill:url(#g)} /* unclosed url(https://x.test)')).toEqual(['#g']);
  });

  it('names @import (and its string), image functions and urls it cannot read', () => {
    expect(urls('@import "x.css"; @\\69mport url(y.css);')).toEqual(['import', 'x.css', 'import', 'y.css']);
    expect(urls('a{fill:image-set("x.png" 1x); b:-webkit-image-set(url(y.png) 1x); c:src("z.svg")}')).toEqual(['image-set()', '-webkit-image-set()', 'y.png', 'src()']);
    expect(urls('a{fill:url(https://x.test/a b)}')).toEqual(['bad-url']);
    expect(urls('a{fill:url(x"y)}')).toEqual(['bad-url']);
  });
});
