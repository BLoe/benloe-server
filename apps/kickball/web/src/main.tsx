import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import './index.css';
import {
  Dashboard,
  GamesRoute,
  RosterRoute,
  RatingsRoute,
  SettingsRoute,
} from './pages/Dashboard';
import { RateGame } from './pages/RateGame';
import { PublicLineup } from './pages/PublicLineup';

function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center px-6 text-center">
      <div>
        <p className="eyebrow mb-3">Foul ball</p>
        <h1 className="display text-4xl mb-4">Nothing at this address</h1>
        <p className="text-chalk/60 mb-7">The link may have expired, or the lineup was unpublished.</p>
        <Link to="/rate" className="btn btn-primary">
          Play the rating game
        </Link>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Redirect before the layout, so landing on the root does not pay for
            a session check just to bounce. */}
        <Route path="/" element={<Navigate to="/games" replace />} />

        <Route element={<Dashboard />}>
          <Route path="/games" element={<GamesRoute />} />
          <Route path="/games/:gameId" element={<GamesRoute />} />
          <Route path="/roster" element={<RosterRoute />} />
          <Route path="/ratings" element={<RatingsRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
        </Route>

        <Route path="/rate" element={<RateGame />} />
        <Route path="/l/:slug" element={<PublicLineup />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
