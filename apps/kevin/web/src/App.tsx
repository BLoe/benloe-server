import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ChatRoute, Shell } from '@/components/shell/Shell';
import { pages, SpacePage } from '@/pages/registry';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          {pages.map((p) => (
            <Route key={p.path} path={p.path} element={<p.component />} />
          ))}
          <Route path="/s/:slug" element={<SpacePage />} />
          <Route path="/chat/:threadId" element={<ChatRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
