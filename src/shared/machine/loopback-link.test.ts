import { describe, expect, it } from 'vitest';
import { forwardedUrl, isLoopbackLink, loopbackPort } from './loopback-link';

describe('loopback links (P5 O7 M3, "Forwarding")', () => {
  it('names the machine port of an http(s) link to localhost, 127.0.0.1, 0.0.0.0, [::] or [::1], written or the scheme’s default', () => {
    expect(loopbackPort('http://localhost:5173/')).toBe(5173);
    expect(loopbackPort('http://127.0.0.1:8000/a/b?c=1#d')).toBe(8000);
    expect(loopbackPort('https://0.0.0.0:3000')).toBe(3000);
    expect(loopbackPort('http://LOCALHOST:8080/x')).toBe(8080);
    expect(loopbackPort('http://localhost.:8080/')).toBe(8080);
    // the parser drops a written default port: it is the scheme's all the same
    expect(loopbackPort('http://localhost:80/')).toBe(80);
    expect(loopbackPort('https://127.0.0.1:443/')).toBe(443);
    expect(loopbackPort('http://localhost/')).toBe(80);
    expect(loopbackPort('https://0.0.0.0/x')).toBe(443);
    expect(loopbackPort('http://127.1:9000/')).toBe(9000); // 127.0.0.1 in a short form
    // IPv6 loopback, written and implied ports (python's http.server prints http://[::]:8000/)
    expect(loopbackPort('http://[::]:8000/')).toBe(8000);
    expect(loopbackPort('http://[::1]:3000/app')).toBe(3000);
    expect(loopbackPort('http://[::]/')).toBe(80);
    expect(loopbackPort('https://[::1]/')).toBe(443);
    expect(loopbackPort('http://[0:0:0:0:0:0:0:1]:5173/')).toBe(5173); // [::1] uncompressed
    expect(loopbackPort('http://[::1]:80/')).toBe(80);
  });

  it('forwards no other link', () => {
    for (const url of ['http://example.com:8080/', 'http://192.168.1.4:8080/', 'ftp://localhost:21/', 'ws://localhost:3000/', 'mailto:a@localhost', 'not a url', 'ws://[::1]:8080/', 'http://[::2]:8080/', 'http://127.0.0.2:8080/', 'http://app.localhost:3000/', 'http://[::ffff:127.0.0.1]:8080/', 'http://[::ffff:7f00:1]:8080/', 'http://[::ffff:0.0.0.0]:8080/', 'file:///etc/hosts']) {
      expect(loopbackPort(url), url).toBeNull();
    }
  });

  it('tells every link to a loopback host, by any scheme, with a port or not', () => {
    for (const url of [
      'http://localhost/',
      'http://localhost:80/',
      'https://127.0.0.1:443/',
      'http://LOCALHOST.:3000',
      'http://app.localhost:3000/',
      'http://127.0.0.2:8080/',
      'http://127.255.255.254/',
      'http://2130706433/', // 127.0.0.1 as one number
      'http://0x7f.1/',
      'http://0.0.0.0:8000/',
      'http://[::1]:8080/',
      'http://[::]:8080/',
      'http://[0:0:0:0:0:0:0:1]/',
      // IPv4-mapped, dotted and as the parser prints it ([::ffff:0:0], [::ffff:7f00:1])
      'http://[::ffff:0.0.0.0]:8080/',
      'http://[::ffff:0:0]:8080/',
      'http://[::ffff:127.0.0.1]:8080/',
      'http://[::ffff:7f00:1]:8080/',
      'http://[0:0:0:0:0:ffff:7f00:1]/',
      'http://[::ffff:127.255.0.9]/',
      'ws://localhost:3000/socket',
      'vnc://LOCALHOST:5900', // a non-special scheme's host isn't lowered by the parser
      'ftp://127.0.0.1/',
      'vnc://localhost:5900',
    ]) {
      expect(isLoopbackLink(url), url).toBe(true);
    }
  });

  it('is not one for another host, or a link with no host', () => {
    for (const url of ['https://example.com/', 'http://localhost.example.com/', 'http://128.0.0.1/', 'http://10.0.0.1/', 'http://[::2]/', 'http://[::ffff:10.0.0.1]/', 'http://[::ffff:a00:1]/', 'http://[::ffff:128.0.0.1]/', 'http://[::ffff:0:1]/', 'vnc://LOCALHOST.example.com/', 'mailto:a@localhost', 'file:///etc/hosts', 'not a url', 'javascript:alert(1)']) {
      expect(isLoopbackLink(url), url).toBe(false);
    }
  });

  it('becomes the same page on this Mac’s listener', () => {
    expect(forwardedUrl('http://localhost:5173/app/?q=1#top', 49152)).toBe('http://127.0.0.1:49152/app/?q=1#top');
    expect(forwardedUrl('http://0.0.0.0:8000', 49153)).toBe('http://127.0.0.1:49153/');
    expect(forwardedUrl('http://localhost/x', 49154)).toBe('http://127.0.0.1:49154/x');
    expect(forwardedUrl('https://127.0.0.1:443/', 49155)).toBe('https://127.0.0.1:49155/');
    // a bracketed IPv6 host replaced whole
    expect(forwardedUrl('http://[::]:8000/dir/?q=1#top', 49156)).toBe('http://127.0.0.1:49156/dir/?q=1#top');
    expect(forwardedUrl('http://[::1]/', 49157)).toBe('http://127.0.0.1:49157/');
  });
});
