import { lazy, StrictMode, Suspense } from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './app/app';

// The play-test seat page, loaded only on its own route. The path matches
// PLAY_PATH in @latency-wars/playtest-contracts; importing it here would pull
// that lib's schemas into the home page's bundle.
const PLAY_PATH = '/play';
const PlayPage = lazy(() => import('./play/play-page'));

// The play-test replay viewer, on its own route for the same reason.
const REPLAY_PATH = '/replay';
const ReplayPage = lazy(() => import('./replay/replay-page'));

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <StrictMode>
    {window.location.pathname.startsWith(PLAY_PATH) ? (
      <Suspense fallback={null}>
        <PlayPage />
      </Suspense>
    ) : window.location.pathname.startsWith(REPLAY_PATH) ? (
      <Suspense fallback={null}>
        <ReplayPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
);