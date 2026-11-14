import type { ComponentType, LazyExoticComponent } from 'react';

export type SceneId = 'session' | 'settings' | 'home' | 'overview' | 'file' | 'artifacts' | 'customize';
export type Scheme = 'light' | 'dark';

/** A choice the viewer can flip while looking, e.g. the dark ground candidate. */
export interface Knob {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
}

export interface ExperimentProps {
  scene: SceneId;
  scheme: Scheme;
  /** Current value of each knob the experiment declared, keyed by knob id. */
  knobs: Record<string, string>;
}

export interface Experiment {
  id: string;
  /** Position in the lab's list; lower comes first. */
  order: number;
  /** Short name shown in the lab. */
  name: string;
  /** One sentence: what this experiment treats as central. */
  thesis: string;
  /** What to look at, and what it costs; a few short lines. */
  notes: string[];
  scenes: SceneId[];
  knobs?: Knob[];
  Component: LazyExoticComponent<ComponentType<ExperimentProps>>;
}
