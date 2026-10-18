// What every view that waits on the hub says once the hub refuses this browser (`access.ts`): why, in one sentence,
// and the one action that mends it. While the hub is merely out of reach, the views keep their connecting states.
import type { Lapse } from '../../hub/access';
import { signInAgain } from '../../hub/access';

/** Why `what` (the grid, this project) cannot update. */
export function lapsedText(lapse: Lapse, what: string): string {
  return lapse === 'signed-out'
    ? `Your sign-in has expired, so ${what} can't update until you sign in again.`
    : `You are signed in, but the org no longer holds you as a member, so ${what} can't update.`;
}

export function SignInAgainButton() {
  return (
    <button type="button" className="h-9 shrink-0 rounded-md border border-fg bg-fg px-3 text-ui-sm font-medium text-bg hover:bg-fg-muted" onClick={signInAgain} data-testid="sign-in-again">
      Sign in again
    </button>
  );
}

/** A view's banner: what cannot update and why, then the action. `lead` opens it (the grid's "Counts as of …"). */
export function LapsedBanner({ lapse, what, lead }: { lapse: Lapse; what: string; lead?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-bg-raised px-4 py-2 text-ui-sm md:px-6" role="alert" data-testid="signed-out">
      <span className="min-w-0 flex-1 text-fg">
        {lead && <strong className="font-medium">{lead} </strong>}
        {lapsedText(lapse, what)}
      </span>
      <SignInAgainButton />
    </div>
  );
}
