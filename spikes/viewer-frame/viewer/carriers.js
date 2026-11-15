// DNS carriers, run inside a page (the viewer's hook imports it; main injects the same source into the control page).
// Every name is `<tok>-<phase>-<what>.example.com`, so the DNS capture says which carrier sent it. Self-contained: no
// imports, nothing outside the function.
export async function carriers(args) {
  const { tok, phase, metaOnLater } = args;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const name = (what) => `${tok}-${phase}-${what}.example.com`;
  const big = 'display:block;width:220px;height:36px;margin:4px;background:#e6e6ff;font:13px sans-serif';
  const host = document.createElement('div');
  document.body.prepend(host);
  if (metaOnLater) {
    // a later meta, inside the content, asking for prefetching back on (the wrapper's own meta said off)
    const m = document.createElement('div');
    m.innerHTML = '<meta http-equiv="x-dns-prefetch-control" content="on">';
    host.append(m);
    await sleep(100);
  }
  const link = document.createElement('link');
  link.rel = 'dns-prefetch';
  link.href = `//${name('link-script')}`;
  document.head.append(link);
  const inert = document.createElement('div');
  inert.innerHTML = `<link rel="dns-prefetch" href="//${name('link-inner')}"><link rel="preconnect" href="http://${name('preconnect')}/">`
    + `<a style="${big}" href="http://${name('a-parse')}/">parse</a>`
    + `<a style="${big}" data-carrier="hover" href="http://${name('a-hover')}/">hover</a>`
    + `<a style="${big}" data-carrier="down" href="http://${name('a-down')}/">down</a>`;
  host.append(inert);
  // a MutationObserver that removes every link the moment it is told of it: whether that comes before the prefetch
  const watched = document.createElement('div');
  host.append(watched);
  new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) { if (n.nodeType !== 1) continue; if (n.localName === 'link') n.remove(); for (const l of n.querySelectorAll?.('link') ?? []) l.remove(); } }).observe(watched, { childList: true, subtree: true });
  watched.innerHTML = `<link rel="dns-prefetch" href="//${name('mo-removed-link')}">`;
  const never = document.createElement('div');
  never.innerHTML = `<link rel="dns-prefetch" href="//${name('detached-never')}"><a href="http://${name('detached-never-a')}/">x</a>`;
  const filtered = document.createElement('div');
  filtered.innerHTML = `<link rel="dns-prefetch" href="//${name('detached-filtered-link')}"><meta http-equiv="x-dns-prefetch-control" content="on"><a href="http://${name('detached-filtered-a')}/">x</a>`;
  await sleep(300);
  for (const el of [...filtered.querySelectorAll('link,meta,base')]) el.remove();
  for (const a of filtered.querySelectorAll('a,area')) { a.setAttribute('data-href', a.getAttribute('href') ?? ''); a.removeAttribute('href'); }
  host.append(filtered);
  const rect = (sel) => { const r = host.querySelector(sel).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  return { hover: rect('[data-carrier=hover]'), down: rect('[data-carrier=down]'), away: { x: 300, y: 5 } };
}
