// The Settings tab's registration into C5's slot (C11 execution document, Repository map; Ask of C5 (1)), and the root
// `--font-mono` override that follows `appearance.monoFont` app-wide, and (W2) the root `--measure` that follows
// `appearance.transcriptWidth`.
import { registerSlot } from '../app/slots';
import { SettingsView } from './SettingsView';

export { SettingsView } from './SettingsView';
export { connectMonoFont } from './mono-font';
export { connectTranscriptWidth } from './transcript-width'; // W2

export function registerSettingsTab(): void {
  registerSlot('settingsTab', SettingsView);
}
