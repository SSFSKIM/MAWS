// Renderer component tests: Customize's page where the layout says it is (UX wave U11c; the page's two fields are U7b's
// `destination`, which `DestinationPage` passes to `CustomizeView`), so a test drives the head and reads the fields as the
// app does. With no Customize page open it draws My items, All, as an opener with nothing asked does.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { Destination } from '@shared/ipc/schema/layout';
import { CustomizeView } from '../customize/CustomizeView';
import { useLayout } from '../stores/layout';

type Where = Omit<Extract<Destination, { kind: 'customize' }>, 'kind'>;

export function CustomizeAtDestination() {
  const destination = useLayout((s) => s.destination);
  const where: Where = destination?.kind === 'customize' ? destination : { view: 'mine', show: 'all' };
  return <CustomizeView view={where.view} show={where.show} />;
}

/** Opens Customize at `where` (the layout's write, as an opener's) and draws it under `client`. */
export function mountCustomize(where: Where, client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  useLayout.getState().openDestination({ kind: 'customize', ...where });
  return render(
    <QueryClientProvider client={client}>
      <CustomizeAtDestination />
    </QueryClientProvider>,
  );
}
