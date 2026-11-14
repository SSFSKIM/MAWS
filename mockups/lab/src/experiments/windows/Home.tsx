import { ArrowUp, ChevronDown, Folder } from 'lucide-react';
import { composer } from '../../content/fixtures';
import { Glass } from './shell';
import { TopBar } from './TopBar';

/** New chat: the environment at its fullest, the sidebar, and one window to write in. */
export function Home() {
  return (
    <>
      <TopBar mode="home" />
      <Glass id="x-windows-home" role="window" label="New chat" className="x-windows-home" radius={28}>
        <div className="x-windows-home-body">
          <textarea className="x-windows-input x-windows-home-input" placeholder="What should we build?" rows={2} aria-label="Message" />
          <div className="x-windows-composer-row">
            <button className="x-windows-pill">
              <Folder size={14} strokeWidth={2.2} />
              {composer.folder}
              <ChevronDown size={13} strokeWidth={2.6} />
            </button>
            <button className="x-windows-pill">
              {composer.model}
              <ChevronDown size={13} strokeWidth={2.6} />
            </button>
            <span className="x-windows-spacer" />
            <button className="x-windows-send" data-kind="go" aria-label="Start the session">
              <ArrowUp size={17} strokeWidth={2.8} />
            </button>
          </div>
        </div>
      </Glass>
    </>
  );
}
