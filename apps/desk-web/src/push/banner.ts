// The first-run opt-in for notifications (mockups/desk/05-phone.html, 9a). iOS asks for the permission only from a tap
// in the installed app, and only once, so the app never asks on launch: after the first unlock there, the grid shows
// one banner whose Turn on is that tap. Not now hides it for good on this device; the lasting control stays in Menu.
import type { PushState } from './device';

export const BANNER_KEY = 'desk.push-banner';

export function bannerDue(input: { installed: boolean; unlocked: boolean; state: PushState | null; dismissed: boolean }): boolean {
  return input.installed && input.unlocked && !input.dismissed && input.state?.kind === 'off';
}

export const bannerDismissed = (): boolean => {
  try {
    return localStorage.getItem(BANNER_KEY) === 'dismissed';
  } catch {
    return false;
  }
};

export function dismissBanner(): void {
  try {
    localStorage.setItem(BANNER_KEY, 'dismissed');
  } catch {
    // Storage refused: the banner goes for this page only.
  }
}
