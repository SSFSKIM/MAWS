// The shell's placement protocol: report the browser pane's rect whenever it changes (ResizeObserver covers window
// resizes and split moves), simulate a split drag in N animation frames, and open or close a sheet that covers the pane.
const pane = document.getElementById('pane');
const sheet = document.getElementById('sheet');
const epoch = () => performance.timeOrigin + performance.now();
const frames = [];
let frameNo = 0;
let lastReason = 'initial';

function rectOf() {
  const r = pane.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
function report(reason, frame = null) {
  const rect = rectOf();
  const msg = { ...rect, t: epoch(), reason, frame, dpr: window.devicePixelRatio, inner: { width: window.innerWidth, height: window.innerHeight } };
  window.shellBridge.place(msg);
  return msg;
}

const ro = new ResizeObserver(() => report(lastReason));
ro.observe(pane);
window.addEventListener('resize', () => { lastReason = 'window-resize'; });

window.__shell = {
  rect: rectOf,
  report,
  inlineRan: () => window.inlineRan === true,
  inner: () => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, screenX: window.screenX, screenY: window.screenY }),
  // A split drag: the split ratio moves from `from` to `to` over `steps` animation frames; each frame reports its rect
  // in the rAF callback (before the frame is presented), then records the time rAF ran.
  async drag(steps = 60, from = 0.42, to = 0.2) {
    frames.length = 0;
    ro.disconnect();
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const tFrame = epoch();
      document.documentElement.style.setProperty('--split', String(from + ((to - from) * i) / steps));
      const msg = report('drag', ++frameNo);
      frames.push({ frame: frameNo, tFrame, tReport: msg.t, rect: { x: msg.x, y: msg.y, width: msg.width, height: msg.height } });
    }
    // one more frame so the last report has been presented
    await new Promise((r) => requestAnimationFrame(r));
    ro.observe(pane);
    return frames.slice();
  },
  setSplit(ratio) { document.documentElement.style.setProperty('--split', String(ratio)); return report('set-split'); },
  openSheet() { const t = epoch(); sheet.hidden = false; window.shellBridge.cover(true, t); return t; },
  closeSheet() { const t = epoch(); sheet.hidden = true; window.shellBridge.cover(false, t); return t; },
  sheetOpen: () => !sheet.hidden,
};

report('initial');
