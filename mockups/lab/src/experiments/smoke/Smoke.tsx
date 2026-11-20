import { useEffect, useRef } from 'react';
import {
  GlassButton,
  GlassGroup,
  GlassRoot,
  GlassSurface,
  GlassToolbar,
  useGlassCapabilities,
  useGlassRoot,
} from '@vitreajs/vitrea-react';
import type { ExperimentProps } from '../../lab/types';

function paint(canvas: HTMLCanvasElement, dark: boolean) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  g.fillStyle = dark ? '#191919' : '#faf9f5';
  g.fillRect(0, 0, w, h);
  const blobs: [number, number, number, string][] = [
    [0.12, 0.2, 0.45, dark ? 'rgba(253,120,15,0.55)' : 'rgba(253,120,15,0.5)'],
    [0.3, 0.85, 0.5, dark ? 'rgba(190,50,60,0.45)' : 'rgba(255,170,120,0.55)'],
    [0.8, 0.3, 0.4, dark ? 'rgba(90,60,160,0.35)' : 'rgba(255,214,150,0.6)'],
  ];
  for (const [x, y, r, c] of blobs) {
    const grad = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h));
    grad.addColorStop(0, c);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  // Fine structure, painted into the plane so the lens has something to displace.
  g.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
  for (let x = 0; x < w; x += 28) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + h * 0.3, h);
    g.stroke();
  }
}

function Plane({ dark }: { dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      paint(c, dark);
      root?.setBackdropTexture('plane', { kind: 'canvas', canvas: c });
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [dark, root]);
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%' }} />;
}

function Readout() {
  const s = useGlassCapabilities('pane');
  return (
    <pre style={{ position: 'fixed', right: 16, bottom: 16, margin: 0, font: '12px ui-monospace', color: '#888' }}>
      {s ? `${s.activeRenderer} · refraction ${s.refraction} · ${s.health}${s.demotionReason ? ` · ${s.demotionReason}` : ''}` : 'resolving…'}
    </pre>
  );
}

export default function Smoke({ scheme }: ExperimentProps) {
  const dark = scheme === 'dark';
  return (
    <GlassRoot renderer="webgpu" colorScheme={scheme}>
      <Plane dark={dark} />
      <GlassGroup id="pane" backdrop={{ kind: 'texture', id: 'plane' }}>
        <GlassSurface asChild radius={28} thickness={8} foreground="vibrant">
          <section
            aria-label="Sidebar"
            data-glass-role="window"
            style={{ position: 'fixed', left: 12, top: 12, bottom: 12, width: 280, boxSizing: 'border-box', padding: 20, colorScheme: scheme }}
          >
            <div style={{ color: 'var(--vitrea-foreground)', font: '600 14px system-ui' }}>atlas-api</div>
            <div style={{ color: 'var(--vitrea-foreground-secondary)', font: '500 13px system-ui', marginTop: 8 }}>
              Rate limiter rewrite
            </div>
          </section>
        </GlassSurface>
      </GlassGroup>
      <GlassToolbar
        aria-label="Actions"
        groupProps={{ id: 'bar', backdrop: { kind: 'texture', id: 'plane' } }}
        style={{ position: 'fixed', top: 24, left: 340 }}
      >
        <GlassButton>Approve</GlassButton>
        <GlassButton>Deny</GlassButton>
      </GlassToolbar>
      <Readout />
    </GlassRoot>
  );
}
