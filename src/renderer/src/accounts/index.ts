// The Accounts tab's registration into C5's slot (C11 execution document, Repository map; Ask of C5 (1)): the singleton
// `accounts` tab renders `AccountsView` once App.tsx's C11 block has called this.
import { registerSlot } from '../app/slots';
import { AccountsView } from './AccountsView';

export { AccountsView } from './AccountsView';
export { accountsViewModel, type AccountRow } from './model';

export function registerAccountsTab(): void {
  registerSlot('accountsTab', AccountsView);
}
