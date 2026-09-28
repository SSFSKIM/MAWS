import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Shell } from './app/Shell';
import { queryClient } from './ipc/query';
import { useSettings } from './stores/settings';

export function App() {
  const resolvedTheme = useSettings((s) => s.state?.resolvedTheme);

  useEffect(() => useSettings.getState().connect(), []);

  // index.html ships data-theme="light" for the first paint; from then on main's resolved theme decides.
  useEffect(() => {
    if (resolvedTheme) document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
