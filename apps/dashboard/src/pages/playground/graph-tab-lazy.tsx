import { lazy } from 'react';

// react-force-graph-2d pulls in d3-force and adds real weight; split it into
// its own chunk so pages that never open the Graph tab don't pay for it.
// Shared by the playground and the dataset browser so both split the same
// chunk instead of each triggering their own dynamic import.
export const LazyGraphTab = lazy(() =>
  import('./graph-tab').then((m) => ({ default: m.GraphTab })),
);
