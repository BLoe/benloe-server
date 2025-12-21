import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Navigation from './components/Navigation';
import GameNightCalendar from './components/GameNightCalendar';
import GameLibrary from './components/GameLibrary';
import ProfileSettings from './components/ProfileSettings';

function App() {
  const { checkAuth, loading } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main>
          <Routes>
            <Route path="/" element={<GameNightCalendar />} />
            <Route path="/games" element={<GameLibrary />} />
            <Route path="/profile" element={<ProfileSettings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
