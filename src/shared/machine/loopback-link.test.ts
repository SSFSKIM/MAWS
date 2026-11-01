import { describe, expect, it } from 'vitest';
import { forwardedUrl, loopbackPort } from './loopback-link';

describe('a loopback link (P5 O7 M3, "Forwarding")', () => {
  it('names the port of an http(s) link to localhost, 127.0.0.1 or 0.0.0.0 that carries one', () => {
    expect(loopbackPort('http://localhost:5173/')).toBe(5173);
    expect(loopbackPort('http://127.0.0.1:8000/a/b?c=1#d')).toBe(8000);
    expect(loopbackPort('https://0.0.0.0:3000')).toBe(3000);
    expect(loopbackPort('http://LOCALHOST:8080/x')).toBe(8080);
  });

  it('is not one without a port, on another host, or of another scheme', () => {
    for (const url of ['http://localhost/', 'http://example.com:8080/', 'http://192.168.1.4:8080/', 'ftp://localhost:21/', 'mailto:a@localhost', 'not a url', 'http://[::1]:8080/']) expect(loopbackPort(url), url).toBeNull();
  });

  it('becomes the same page on this Mac’s listener', () => {
    expect(forwardedUrl('http://localhost:5173/app/?q=1#top', 49152)).toBe('http://127.0.0.1:49152/app/?q=1#top');
    expect(forwardedUrl('http://0.0.0.0:8000', 49153)).toBe('http://127.0.0.1:49153/');
  });
});
