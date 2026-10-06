import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/Shell';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Today from './pages/Today';
import Week from './pages/Week';
import Changed from './pages/Changed';
import Tasks from './pages/Tasks';
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
          path="/week"
          element={
            <AuthGuard>
              <Week />
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