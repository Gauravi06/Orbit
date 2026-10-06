import { useState, useRef, useEffect } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Sparkles,
  CheckSquare,
  Palette,
  LogOut,
  Sliders,
  ChevronDown,
  RotateCcw,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { resetDemo } from '../api/client';
import './Shell.css';

const IS_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const IS_DEV = import.meta.env.DEV;

export function Shell({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  const handleLogout = () => {
    try {
      localStorage.removeItem('orbit_token');
      localStorage.removeItem('token');
    } catch { /* ignore */ }
    navigate('/login');
  };

  const handleResetDemo = async () => {
    await resetDemo();
    setMenuOpen(false);
    window.location.reload();
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-header-inner">
          <Link to="/today" className="shell-brand">
            <span className="shell-brand-symbol">◐</span>
            <span className="shell-brand-title">Orbit</span>
            <span className="shell-brand-tagline">Balance without burnout</span>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="shell-nav" aria-label="Main Navigation">
            <NavLink
              to="/today"
              className={({ isActive }) =>
                `shell-nav-link ${isActive ? 'active' : ''}`
              }
            >
              <Calendar size={15} strokeWidth={1.5} />
              <span>Today</span>
            </NavLink>
            <NavLink
              to="/changed"
              className={({ isActive }) =>
                `shell-nav-link ${isActive ? 'active' : ''}`
              }
            >
              <Sparkles size={15} strokeWidth={1.5} />
              <span>Something changed?</span>
            </NavLink>
            <NavLink
              to="/tasks"
              className={({ isActive }) =>
                `shell-nav-link ${isActive ? 'active' : ''}`
              }
            >
              <CheckSquare size={15} strokeWidth={1.5} />
              <span>Tasks</span>
            </NavLink>
            {IS_DEV && (
              <NavLink
                to="/design"
                className={({ isActive }) =>
                  `shell-nav-link ${isActive ? 'active' : ''}`
                }
              >
                <Palette size={15} strokeWidth={1.5} />
                <span>Design</span>
              </NavLink>
            )}
          </nav>

          {/* Right actions: ThemeToggle + User Menu */}
          <div className="shell-actions">
            <ThemeToggle showLabel={false} />

            <div className="shell-user-menu" ref={menuRef}>
              <button
                type="button"
                className="shell-user-btn"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="User menu"
                aria-expanded={menuOpen}
              >
                <div className="shell-user-avatar">D</div>
                <ChevronDown size={13} strokeWidth={1.5} />
              </button>

              {menuOpen && (
                <div className="shell-dropdown">
                  <Link
                    to="/onboarding"
                    className="shell-dropdown-item"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Sliders size={13} strokeWidth={1.5} />
                    <span>Preferences</span>
                  </Link>
                  {IS_DEV && (
                    <Link
                      to="/design"
                      className="shell-dropdown-item"
                      onClick={() => setMenuOpen(false)}
                    >
                      <Palette size={13} strokeWidth={1.5} />
                      <span>Design Guide</span>
                    </Link>
                  )}
                  {IS_MOCK && (
                    <button
                      type="button"
                      className="shell-dropdown-item"
                      onClick={handleResetDemo}
                    >
                      <RotateCcw size={13} strokeWidth={1.5} />
                      <span>Reset demo</span>
                    </button>
                  )}
                  <div className="shell-dropdown-divider" />
                  <button
                    type="button"
                    className="shell-dropdown-item"
                    onClick={handleLogout}
                    style={{ color: 'var(--error)' }}
                  >
                    <LogOut size={13} strokeWidth={1.5} />
                    <span>Log out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="shell-main">{children}</main>

      {/* Mobile-only bottom navigation bar */}
      <nav className="shell-mobile-nav" aria-label="Mobile Navigation">
        <NavLink
          to="/today"
          className={({ isActive }) =>
            `shell-mobile-link ${isActive ? 'active' : ''}`
          }
        >
          <Calendar size={18} strokeWidth={1.5} />
          <span>Today</span>
        </NavLink>
        <NavLink
          to="/changed"
          className={({ isActive }) =>
            `shell-mobile-link ${isActive ? 'active' : ''}`
          }
        >
          <Sparkles size={18} strokeWidth={1.5} />
          <span>Changed?</span>
        </NavLink>
        <NavLink
          to="/tasks"
          className={({ isActive }) =>
            `shell-mobile-link ${isActive ? 'active' : ''}`
          }
        >
          <CheckSquare size={18} strokeWidth={1.5} />
          <span>Tasks</span>
        </NavLink>
        {IS_DEV && (
          <NavLink
            to="/design"
            className={({ isActive }) =>
              `shell-mobile-link ${isActive ? 'active' : ''}`
            }
          >
            <Palette size={18} strokeWidth={1.5} />
            <span>Design</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}

export default Shell;
