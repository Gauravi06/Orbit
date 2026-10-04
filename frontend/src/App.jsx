import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/Shell';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Today from './pages/Today';
import Changed from './pages/Changed';
import Tasks from './pages/Tasks';
import DesignGuide from './pages/DesignGuide';
import './styles/base.css';

function AuthGuard({ children }) {
  let isAuthed = false;
  try {
    isAuthed = !!(localStorage.getItem('orbit_token') || localStorage.getItem('token'));
  } catch {
    // defaults to false
  }

  if (!isAuthed) {
    return <Navigate to="/login" replace />;
  }

  return <Shell>{children}</Shell>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/design" element={<DesignGuide />} />

        {/* Protected App Routes */}
        <Route
          path="/today"
          element={
            <AuthGuard>
              <Today />
            </AuthGuard>
          }
        />
        <Route
          path="/changed"
          element={
            <AuthGuard>
              <Changed />
            </AuthGuard>
          }
        />
        <Route
          path="/tasks"
          element={
            <AuthGuard>
              <Tasks />
            </AuthGuard>
          }
        />
        <Route
          path="/onboarding"
          element={
            <AuthGuard>
              <Onboarding />
            </AuthGuard>
          }
        />

        {/* Default / Fallback */}
        <Route path="/" element={<Navigate to="/today" replace />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;