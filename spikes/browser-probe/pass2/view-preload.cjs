// The browser view's preload, sandboxed as MAWS's would be (only `electron` is requirable). It records every input
// event the page receives, with everything the DOM exposes that might tell a human's event from a synthesised one, and
// reports each over IPC to main (`probe:dom-event`) at once. A main-world getter exposes the same list to a driver.
const { ipcRenderer, contextBridge } = require('electron');

const events = [];
const epoch = () => performance.timeOrigin + performance.now();
const name = (el) => (el && el.nodeType === 1 ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` : String(el && el.nodeName));

function describe(e) {
  const d = {
    type: e.type,
    isTrusted: e.isTrusted,
    // DOM timeStamp is relative to performance.timeOrigin; `atEpoch` is the same instant on the shared clock.
    timeStamp: e.timeStamp,
    atEpoch: performance.timeOrigin + e.timeStamp,
    seenEpoch: epoch(),
    sourceCapabilities: e.sourceCapabilities ? { firesTouchEvents: e.sourceCapabilities.firesTouchEvents } : null,
    target: name(e.target),
    detail: e.detail,
    composed: e.composed,
  };
  if ('pointerType' in e) Object.assign(d, { pointerType: e.pointerType, pointerId: e.pointerId, isPrimary: e.isPrimary, pressure: e.pressure, width: e.width, height: e.height });
  if ('clientX' in e) Object.assign(d, { clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, movementX: e.movementX ?? null, movementY: e.movementY ?? null, button: e.button, buttons: e.buttons, altKey: e.altKey, metaKey: e.metaKey });
  if ('key' in e) Object.assign(d, { key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat, location: e.location, isComposing: e.isComposing });
  if (e.type === 'input' || e.type === 'beforeinput') Object.assign(d, { inputType: e.inputType, data: e.data });
  if ('deltaY' in e) Object.assign(d, { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode });
  return d;
}

for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'wheel', 'focus', 'blur']) {
  window.addEventListener(
    type,
    (e) => {
      const d = describe(e);
      events.push(d);
      if (type !== 'pointermove' && type !== 'mousemove') ipcRenderer.send('probe:dom-event', d);
    },
    { capture: true, passive: true },
  );
}

ipcRenderer.on('probe:reset-events', () => { events.length = 0; });

contextBridge.exposeInMainWorld('__probeInput', {
  events: () => events.slice(),
  clear: () => { events.length = 0; },
  epoch,
  screenOffset: () => ({ screenX: window.screenX, screenY: window.screenY, outerWidth: window.outerWidth, innerWidth: window.innerWidth, outerHeight: window.outerHeight, innerHeight: window.innerHeight, dpr: window.devicePixelRatio }),
});
