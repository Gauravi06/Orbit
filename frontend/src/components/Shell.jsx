import { useState, useRef, useEffect } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Sparkles,
  CheckSquare,
  LogOut,
  Sliders,
  ChevronDown,
  RotateCcw,
  Check,
  Columns,
  Bell,
  AlertTriangle,
  Clock,
  X,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { useTheme, PALETTES } from '../theme/useTheme';
import { resetDemo, seedDemoStudent, getInterventions, dismissIntervention, snoozeIntervention } from '../api/client';
import './Shell.css';

const IS_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

function computeSnoozeIso(hours = 3) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

export function Shell({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const { palette, setPalette } = useTheme();

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

  const handleSeedDemoStudent = async () => {
    await seedDemoStudent();
    setMenuOpen(false);
    navigate('/today');
    window.location.reload();
  };

  const [interventions, setInterventions] = useState([]);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const list = await getInterventions('active');
        if (!ignore) {
          setInterventions(Array.isArray(list) ? list : []);
        }
      } catch {
        // Ignore background fetch errors in shell
      }
    };

    load();
    const interval = setInterval(load, 30000);
    const handleUpdate = () => { load(); };
    window.addEventListener('orbit-interventions-updated', handleUpdate);
    return () => {
      ignore = true;
      clearInterval(interval);
      window.removeEventListener('orbit-interventions-updated', handleUpdate);
    };
  }, []);

  const handleSnooze = async (id, hours = 3) => {
    try {
      const snoozeUntil = computeSnoozeIso(hours);
      await snoozeIntervention(id, snoozeUntil);
      window.dispatchEvent(new Event('orbit-interventions-updated'));
    } catch (e) {
      console.error('Failed to snooze intervention', e);
    }
  };

  const handleDismiss = async (id) => {
    try {
      await dismissIntervention(id);
      window.dispatchEvent(new Event('orbit-interventions-updated'));
    } catch (e) {
      console.error('Failed to dismiss intervention', e);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(event.target)) {
        setBellOpen(false);
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
              to="/week"
              className={({ isActive }) =>
                `shell-nav-link ${isActive ? 'active' : ''}`
              }
            >
              <Columns size={15} strokeWidth={1.5} />
              <span>Week</span>
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
            <NavLink
              to="/insights"
              className={({ isActive }) =>
                `shell-nav-link ${isActive ? 'active' : ''}`
              }
            >
              <Sparkles size={15} strokeWidth={1.5} />
              <span>What Orbit learned</span>
            </NavLink>
          </nav>

          {/* Right actions: ThemeToggle + User Menu */}
          <div className="shell-actions">
            {/* Proactive Intervention Notification Bell */}
            <div className="shell-bell-wrapper" ref={bellRef}>
              <button
                type="button"
                className="shell-bell-btn"
                onClick={() => setBellOpen(!bellOpen)}
                aria-label={`Interventions (${interventions.length} active)`}
                aria-expanded={bellOpen}
              >
                <Bell size={15} strokeWidth={2.2} />
                {interventions.length > 0 && (
                  <span className="shell-bell-badge" aria-hidden="true">
                    {interventions.length}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="shell-bell-popover" role="dialog" aria-label="Active Interventions">
                  <div className="shell-bell-header">
                    <span className="shell-bell-title">
                      <AlertTriangle size={14} strokeWidth={2.5} style={{ color: '#FF5500' }} />
                      Proactive Alerts ({interventions.length})
                    </span>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                      onClick={() => setBellOpen(false)}
                      aria-label="Close notifications"
                    >
                      <X size={13} strokeWidth={2.2} />
                    </button>
                  </div>

                  {interventions.length === 0 ? (
                    <div className="shell-bell-empty">
                      All caught up! No urgent deadline alerts right now.
                    </div>
                  ) : (
                    interventions.map((inv) => (
                      <div
                        key={inv.id}
                        className={`shell-intervention-item ${inv.intervention_type === 'overdue' ? 'overdue' : (inv.intervention_type === 'repeated_unfinished' ? 'repeated-unfinished' : 'approaching')}`}
                      >
                        <div className="shell-intervention-item-title">
                          <AlertTriangle size={13} strokeWidth={2.2} />
                          <span>{inv.title}</span>
                        </div>
                        <div className="shell-intervention-item-msg">{inv.message}</div>
                        <div className="shell-intervention-actions">
                          <button
                            type="button"
                            className="shell-intervention-btn snooze"
                            onClick={() => handleSnooze(inv.id, 3)}
                            title="Snooze for 3 hours"
                          >
                            <Clock size={11} strokeWidth={2} />
                            <span>Snooze 3h</span>
                          </button>
                          <button
                            type="button"
                            className="shell-intervention-btn dismiss"
                            onClick={() => handleDismiss(inv.id)}
                            title="Dismiss alert"
                          >
                            <X size={11} strokeWidth={2} />
                            <span>Dismiss</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

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
                    to="/week"
                    className="shell-dropdown-item"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Columns size={13} strokeWidth={1.5} />
                    <span>Your Week</span>
                  </Link>
                  <Link
                    to="/onboarding"
                    className="shell-dropdown-item"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Sliders size={13} strokeWidth={1.5} />
                    <span>Preferences</span>
                  </Link>

                  {/* Palette Picker in User Menu */}
                  <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--ink-muted)',
                        marginBottom: 'var(--space-1)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      Palette
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                      {PALETTES.map((p) => {
                        const isSelected = palette === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPalette(p.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-sm)',
                              border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
                              backgroundColor: isSelected ? 'var(--surface-2)' : 'transparent',
                              color: 'var(--ink)',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            <span>{p.name}</span>
                            {isSelected && <Check size={11} strokeWidth={2} style={{ color: 'var(--accent)' }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {IS_MOCK && (
                    <>
                      <button
                        type="button"
                        className="shell-dropdown-item"
                        onClick={handleSeedDemoStudent}
                      >
                        <Sparkles size={13} strokeWidth={1.5} style={{ color: 'var(--pop-yellow)' }} />
                        <span>Load 14-day demo</span>
                      </button>
                      <button
                        type="button"
                        className="shell-dropdown-item"
                        onClick={handleResetDemo}
                      >
                        <RotateCcw size={13} strokeWidth={1.5} />
                        <span>Reset demo</span>
                      </button>
                    </>
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
          to="/week"
          className={({ isActive }) =>
            `shell-mobile-link ${isActive ? 'active' : ''}`
          }
        >
          <Columns size={18} strokeWidth={1.5} />
          <span>Week</span>
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
        <NavLink
          to="/insights"
          className={({ isActive }) =>
            `shell-mobile-link ${isActive ? 'active' : ''}`
          }
        >
          <Sparkles size={18} strokeWidth={1.5} />
          <span>Learned</span>
        </NavLink>
      </nav>
    </div>
  );
}

export default Shell;
