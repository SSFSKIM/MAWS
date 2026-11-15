// Open File… (UX wave U6e): the tests come first; the module is built after them.
import type { ClientPort } from '@shared/client/port';
import type { AppSessionId } from '@shared/graph/ids';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandResult } from '@shared/ipc/schema';
import type { MainContext } from '../ipc/router';

const unbuilt = (): never => {
  throw new Error('U6e M2: not built yet');
};
export const isAppPage = (_client: ClientRef): boolean => unbuilt();
export const appPageOnly = (_name: string, _input: unknown, _ctx: MainContext): undefined => unbuilt();
export interface OpenFileDeps {
  port: Pick<ClientPort, 'pick'>;
  isAppPage(client: ClientRef): boolean;
  grant(input: { appSessionId: AppSessionId; path: string }): Promise<CommandResult<'files.grant'>>;
}
export const openChosenFile = (_input: { appSessionId: AppSessionId }, _ctx: Pick<MainContext, 'client' | 'target'>, _deps: OpenFileDeps): Promise<unknown> => unbuilt();
