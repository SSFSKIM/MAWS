// One page per platform: each mode's driver.json reduced to the numbers M7 records (node summarize.mjs <results dir>).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const results = process.argv[2];
const MB = 1_000_000;
const pick = (phase, keys) => (phase ? Object.fromEntries(keys.filter((k) => k in phase).map((k) => [k, phase[k]])) : null);
const memoryOf = (reading) => (reading ? { treeRssKiB: reading.treeRssKiB, treeWorkingSetKiB: reading.treeWorkingSetKiB, treeFootprintKiB: reading.treeFootprintKiB, processes: reading.processes?.map((p) => `${p.type}${p.serviceName ? ':' + p.serviceName : ''} rss ${p.rssKiB}${p.footprintKiB != null ? ' fp ' + p.footprintKiB : ''}`) } : null);
const cadence = ['frames', 'fps', 'medianIntervalMs', 'p95IntervalMs', 'bytesPerSecond', 'medianFrameBytes', 'maxFrameBytes', 'bytesPerSecondAt10fps', 'pageTicksPerSecond', 'hostToViewerMedianMs', 'frameWidths', 'failed'];
const trips = ['clicks', 'landed', 'missing', 'medianMs', 'p95Ms', 'minMs', 'maxMs', 'dispatchMedianMs', 'lastClickTrusted', 'failed'];

const modes = {};
for (const name of readdirSync(results).sort()) {
  const file = join(results, name, 'driver.json');
  try {
    statSync(file);
  } catch {
    continue;
  }
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const p = r.phases ?? {};
  const host = r.host ?? {};
  const step = (n) => host.steps?.find((s) => s.name === n);
  const tick = p['text page ticking at 10 Hz (cdp)'];
  modes[name] = {
    ready: { msFromSpawn: r.ready?.msFromSpawn, hostSaysReady: !!r.ready?.cuaSocket, versions: step('ready')?.versions, dockVisible: step('ready')?.dockVisible, headless: step('ready')?.headless, noSandbox: step('ready')?.noSandbox, pageState: step('tab loaded')?.pageState, peer: step('cua socket')?.peer },
    cua: pick(p['cua primitives'], ['helloMs', 'tabs', 'attachMs', 'titleMs', 'title', 'captureScreenshotMs', 'captureScreenshotBytes', 'vendorScreenshot', 'cuaClickMs', 'cuaClickLanded', 'createdTab', 'failed']),
    screencastStatic: p['screencast static'],
    clickToPaint: pick(p['click to paint (cdp)'], trips),
    textTick10Hz: pick(tick, cadence),
    textScroll: pick(p['text page scrolling (cdp)'], cadence),
    collision: p['collision with the agent screenshot'],
    subscriptionTick10Hz: pick(p['subscription: text page ticking at 10 Hz'], cadence),
    subscriptionClickToPaint: pick(p['subscription: click to paint'], trips),
    memory: {
      atReadyNoTab: memoryOf(step('memory at ready, no tab')),
      oneTabIdle: memoryOf(step('memory one tab loaded, idle')),
      oneTabStreaming: memoryOf(p['memory while streaming']?.reading),
      oneTabIdleAfterScreencast: memoryOf(p['screencast stopped, idle']?.reading),
    },
    criterion: tick && !tick.failed ? { bytesPerSecondAt10fps: tick.bytesPerSecondAt10fps, under1_5MBps: tick.bytesPerSecondAt10fps !== null && tick.bytesPerSecondAt10fps < 1.5 * MB, measuredFps: tick.fps } : null,
    hostExit: r.hostExit,
    hostErrors: host.errors?.map((e) => `${e.name}: ${e.message.split('\n')[0]}`) ?? null,
    errors: r.errors,
    hostStderrTail: r.hostStderrTail,
  };
}
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), modes }, null, 2));
