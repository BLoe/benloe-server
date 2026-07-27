import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './index.css';
import { Dashboard } from './pages/Dashboard';
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
        <Route path="/" element={<Dashboard />} />
        <Route path="/rate" element={<RateGame />} />
        <Route path="/l/:slug" element={<PublicLineup />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
