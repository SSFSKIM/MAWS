#!/usr/bin/env python3
# UX wave U11, O-14 (the U11 draft's "Probes and checks": what Google's favicon address answers). Plain HTTPS from the
# VM, no engine: one GET per site in the draft's one request form, no cookie, redirects not followed, a generic client
# name. Prints one JSON object per answer: status, content type, byte size, PNG pixel size (from IHDR; or the first
# bytes' signature when not PNG), whether a redirect, and the cache headers. Run: python3 -I uxwave-u11-favicon.py OUT
import json, struct, subprocess, sys, tempfile, os, hashlib
SITES = ['google.com', 'wikipedia.org', 'github.com', 'mozilla.org', 'python.org', 'apple.com', 'microsoft.com',
         'stackoverflow.com', 'reddit.com', 'nytimes.com', 'bbc.com', 'slack.com', 'notion.so', 'example.com', 'iana.org']
MISSING = ['no-such-site-p7k2q9.com', 'unregistered-zx81-0000.org', 'nonexistent-icon-test-31415.net']
UA = 'favicon-check/1.0'
def fetch(url):
    with tempfile.TemporaryDirectory() as d:
        body, head = os.path.join(d, 'b'), os.path.join(d, 'h')
        w = subprocess.run(['curl', '-sS', '--max-redirs', '0', '-A', UA, '-H', 'accept: image/*', '-D', head, '-o', body,
                            '-w', '%{http_code} %{redirect_url}', url], capture_output=True, text=True, timeout=30)
        code, _, redirect = w.stdout.partition(' ')
        headers = {}
        for line in open(head, encoding='latin-1').read().splitlines()[1:]:
            k, _, v = line.partition(':')
            if k: headers[k.strip().lower()] = v.strip()
        data = open(body, 'rb').read() if os.path.exists(body) else b''
    px = None
    if data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= 24:
        px = list(struct.unpack('>II', data[16:24]))
    return {'status': int(code or 0), 'redirect': redirect or None, 'contentType': headers.get('content-type'),
            'bytes': len(data), 'png': data[:8] == b'\x89PNG\r\n\x1a\n', 'pixels': px, 'magic': data[:4].hex(),
            'sha256': hashlib.sha256(data).hexdigest()[:16],
            'cache': {k: headers[k] for k in ('cache-control', 'expires', 'age', 'last-modified', 'etag', 'date', 'vary') if k in headers},
            'setCookie': 'set-cookie' in headers, 'stderr': w.stderr.strip() or None}
FORM = 'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://{site}&size={size}'
out = []
for site in SITES + MISSING:
    out.append({'site': site, 'known': site in SITES, 'size': 128, **fetch(FORM.format(site=site, size=128))})
for site in ['github.com', MISSING[0]]:  # the same at size=64, and the older address that redirects here
    out.append({'site': site, 'known': site in SITES, 'size': 64, **fetch(FORM.format(site=site, size=64))})
    out.append({'site': site, 'known': site in SITES, 'via': 'www.google.com/s2/favicons', **fetch(f'https://www.google.com/s2/favicons?domain={site}&sz=128')})
with open(sys.argv[1], 'w') as f:
    for row in out: f.write(json.dumps(row) + '\n')
for row in out:
    print(row['site'], row.get('via', row.get('size')), row['status'], row['contentType'], row['bytes'], row['pixels'], row['redirect'], row['cache'].get('cache-control'), row['sha256'])
