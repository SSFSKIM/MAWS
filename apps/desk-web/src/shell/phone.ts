// A project on a phone (the owner's verdict on mockups/desk/05-phone.html, 3A): it opens on its channel list, and a
// channel is pushed over it, back returning to the list. DX8's route stays as it is: a session channel is its own route,
// and the group chat shares the project's route with the list, so which of the two shows is this state — set when
// the owner opens the group chat from the list, and dropped on every route change (back from a session, a link, a
// notification), which brings the list back.
import { create } from 'zustand';
import { useDeskLayout } from './layout';

export const usePhoneProject = create<{ groupChatOpen: boolean }>()(() => ({ groupChatOpen: false }));

useDeskLayout.subscribe((state, previous) => {
  if (state.route !== previous.route) usePhoneProject.setState({ groupChatOpen: false });
});

/** On a phone, whether a project shows its channel list (rather than one of its channels). */
export const phoneShowsList = (channel: { kind: 'group' | 'session' }, groupChatOpen: boolean) => channel.kind === 'group' && !groupChatOpen;
