// The document fixture's e2e seam (P3-D M7; docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md, Acceptance 10 to
// 13): `window.__maws_design_system_fixture`, installed only in a window main loaded for the e2e harness (`e2e=1`, as
// A's store seam). It mounts a minimal document page in a `<DesignSystemScope>` (the document medium's `tokens.css`,
// nothing else) through the window's own ArtifactHost, so a spec sees a consumer restyle with its system, or hold a
// retained version's pin, before B's editor exists. It stands for B's page element (Decision Log 13): the scope wraps
// the page, the page reads `var(--ds-*)` and the `.ds-type-*` classes. Each fixture is an `article[data-ds-fixture]`
// whose `data-status` is the system's (`loading`, `ready`, `missing`); the layer lets pointer events through.
// A fixture mounted `{governedBy: placement}` names no system: it resolves the one governing an artifact so placed, as B's
// and C's scopes will, through `useGoverningSystem` with the settings' defaults and the window's house system (the P3
// spec's Decision Log 61), and says which in `data-ds-system` (an id, or `floor`).
import { createRoot, type Root } from 'react-dom/client';
import { DesignSystemScope, useDesignSystem, useGoverningSystem, type DesignSystemRef } from '@artifacts/design-system/apply';
import { useSettings } from '../../stores/settings';
import { DesignSystemHostProvider } from './provider';

type SystemRef = DesignSystemRef | { builtin: 'maws' } | null;
type Placement = { designSystemId?: string | null; spaceId?: string | null };
type FixtureSystem = SystemRef | { governedBy: Placement };

export interface DesignSystemFixtureSeam {
  /**
   * Shows the fixture `name` in `system` (a live ref, a version ref, the floor, none, or the system governing an artifact
   * placed as `governedBy` says), replacing one of that name.
   */
  mount(name: string, system: FixtureSystem): void;
  unmount(name: string): void;
}

declare global {
  interface Window {
    __maws_design_system_fixture?: DesignSystemFixtureSeam;
  }
}

const NO_SPACES: Record<string, string> = {};

function GovernedFixturePage({ name, placement }: { name: string; placement: Placement }) {
  const artifacts = useSettings((s) => s.state?.settings.artifacts);
  const system = useGoverningSystem(placement, { owner: artifacts?.defaultDesignSystem ?? null, spaces: artifacts?.spaceDesignSystems ?? NO_SPACES });
  return <FixturePage name={name} system={system} />;
}

function FixturePage({ name, system }: { name: string; system: SystemRef }) {
  const { status } = useDesignSystem(system);
  return (
    <DesignSystemScope system={system} medium="document">
      <article
        className="ds-doc"
        data-ds-fixture={name}
        data-ds-system={system === null ? undefined : 'builtin' in system ? 'floor' : system.id}
        data-status={status}
        style={{ background: 'var(--ds-color-bg)', color: 'var(--ds-color-text)', padding: 'var(--ds-space-4)', borderRadius: 'var(--ds-radius-md)' }}
      >
        <h1 className="ds-type-title">Syllabus</h1>
        <p className="ds-type-body">
          Week one opens with the{' '}
          <a data-part="accent" style={{ color: 'var(--ds-color-accent)' }}>
            lab safety quiz
          </a>
          .
        </p>
      </article>
    </DesignSystemScope>
  );
}

export function installDesignSystemFixture(win: Window): void {
  const fixtures = new Map<string, { system: FixtureSystem; mounted: number }>();
  let mounts = 0;
  let root: Root | null = null;
  const render = () => {
    if (root === null) {
      const layer = win.document.createElement('div');
      layer.setAttribute('data-ds-fixtures', '');
      Object.assign(layer.style, { position: 'fixed', left: '0', bottom: '0', width: '360px', zIndex: '2147483647', pointerEvents: 'none' });
      win.document.body.append(layer);
      root = createRoot(layer);
    }
    root.render(
      <DesignSystemHostProvider>
        {[...fixtures].map(([name, { system, mounted }]) =>
          system !== null && 'governedBy' in system ? (
            <GovernedFixturePage key={`${name}:${mounted}`} name={name} placement={system.governedBy} />
          ) : (
            <FixturePage key={`${name}:${mounted}`} name={name} system={system} />
          ),
        )}
      </DesignSystemHostProvider>,
    );
  };
  win.__maws_design_system_fixture = {
    mount(name, system) {
      fixtures.set(name, { system, mounted: ++mounts }); // a new key: mounted anew (a view still held elsewhere is shared, as every scope shares it)
      render();
    },
    unmount(name) {
      fixtures.delete(name);
      render();
    },
  };
}
