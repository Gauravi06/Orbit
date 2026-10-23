import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Trash2,
  Plus,
  Clock,
  Calendar,
  Zap,
  ArrowRight,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Check,
} from 'lucide-react';
import {
  getTasks,
  createTask,
  deleteTask,
  updateTask,
  generateSchedule,
  errText,
  parseTaskSemantics,
} from '../api/client';
import { formatTime12 } from '../utils/timeFormat';
import './Tasks.css';

export function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Left card: "What’s new?" natural-language text input
  const [nlText, setNlText] = useState('');

  // Right card: "Prefer more control?" structured form fields
  const [form, setForm] = useState({
    title: '',
    estimated_duration: 60,
    deadline: '',
    natural_language_note: '',
  });

  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const fetchTasks = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getTasks();
        if (active) setTasks(data || []);
      } catch (err) {
        if (active) setError(errText(err));
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchTasks();
    return () => {
      active = false;
    };
  }, []);

  const loadTasksData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getTasks();
      setTasks(data || []);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  // Left card handler: "What's new?"
  // Quick natural-language entry: uses existing parseTaskSemantics to extract title, duration, and notes.
  // Note: This creates a "have_to" (Need To) task with a deadline if parseable or default.
  const handleQuickAdd = async (e) => {
    e.preventDefault();
    if (!nlText.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const parsed = parseTaskSemantics(nlText.trim());
      const duration = parsed?.estimated_duration || 60;
      const tier = parsed?.tier || 'have_to';
      const priority = parsed?.priority || (tier === 'have_to' ? 5 : tier === 'need_to' ? 3 : 1);

      // Extract title from semantic parser, falling back to split-character heuristic
      let title = parsed?.clean_title || parsed?.title || '';
      if (!title) {
        const parts = nlText.split(/[,;\-–\n]/);
        if (parts.length > 1 && parts[0].trim().length > 1) {
          title = parts[0].trim();
        } else {
          title = nlText.trim();
        }
      }

      // Check if deadline date string was mentioned or default to upcoming Friday 23:59 local time
      let deadline = null;
      if (parsed?.deadline) {
        deadline = parsed.deadline;
      } else {
        // Default to upcoming Friday 23:59:00
        const d = new Date();
        const day = d.getDay();
        const diff = (5 - day + 7) % 7 || 7;
        const due = new Date(d);
        due.setDate(d.getDate() + diff);
        const y = due.getFullYear();
        const m = String(due.getMonth() + 1).padStart(2, '0');
        const dt = String(due.getDate()).padStart(2, '0');
        deadline = `${y}-${m}-${dt}T23:59:00`;
      }

      const payload = {
        title,
        tier,
        priority,
        estimated_duration: duration,
        duration,
        frequency: parsed?.frequency || 'One-time',
        task_type: parsed?.task_type || 'deadline',
        deadline,
        natural_language_note: nlText.trim(),
        semantic_preferences: parsed && !parsed.isEmpty ? parsed : null,
        is_fixed: false,
      };

      await createTask(payload);
      const tierLabel = tier === 'have_to' ? 'Need To' : tier === 'need_to' ? 'Should Do' : 'Like To';
      setMessage(`Added "${title}" (${tierLabel}, due ${new Date(deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}).`);
      setNlText('');
      await loadTasksData();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Right card handler: "Prefer more control?"
  const handleStructuredAdd = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const parsed = form.natural_language_note.trim()
        ? parseTaskSemantics(form.natural_language_note.trim(), form)
        : null;

      const duration = Number(form.estimated_duration) || 60;

      const payload = {
        title: form.title.trim(),
        tier: 'have_to', // Always "Need To" per requirements
        priority: 5,
        estimated_duration: duration,
        duration,
        frequency: 'One-time',
        task_type: 'deadline',
        deadline: form.deadline ? form.deadline : null,
        natural_language_note: form.natural_language_note.trim() ? form.natural_language_note.trim() : null,
        semantic_preferences: parsed && !parsed.isEmpty ? parsed : null,
        is_fixed: false,
      };

      await createTask(payload);
      setMessage(`"${form.title.trim()}" added to your tasks.`);
      setForm({
        title: '',
        estimated_duration: 60,
        deadline: '',
        natural_language_note: '',
      });
      await loadTasksData();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteTask = async (task) => {
    try {
      if (typeof updateTask === 'function') {
        await updateTask(task.id, { done: true, status: 'completed' });
      } else {
        await deleteTask(task.id);
      }
      setMessage(`Marked "${task.title}" as complete.`);
      await loadTasksData();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleDeleteTask = async (id) => {
    try {
      await deleteTask(id);
      await loadTasksData();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleUpdateSchedule = async () => {
    setSubmitting(true);
    try {
      await generateSchedule();
      navigate('/today');
    } catch (err) {
      setError(errText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Task-list rules:
  // Show ONLY active "Need To" tasks with an actual due date.
  // Exclude study goals, "Should Do", "Like To", recurring habits, and fixed commitments without deadlines.
  // Remove completed tasks.
  const plateTasks = tasks.filter((t) => {
    if (t.is_fixed) return false;
    if (t.done || t.status === 'completed') return false;

    // Must be "Need To" (tier: 'have_to' or priority >= 4)
    const isNeedTo = t.tier === 'have_to' || (!t.tier && Number(t.priority) >= 4);
    if (!isNeedTo) return false;

    // Must have an actual due date
    if (!t.deadline) return false;

    // Exclude recurring habits
    const freq = (t.frequency || '').toLowerCase().trim();
    if (freq && freq !== 'one-time' && freq !== 'one-off') return false;

    // Exclude general study session/block kinds
    const kind = (t.kind || '').toLowerCase();
    if (kind === 'break' || kind === 'routine' || kind === 'decompression' || kind === 'deep') return false;

    return true;
  });

  const pastelClasses = ['card-yellow', 'card-pink', 'card-lavender', 'card-lime'];

  return (
    <div className="tasks-page">
      {/* Hand-drawn student-life doodles around edges (in decorative areas only, never over forms) */}
      <div className="tasks-doodles-layer" aria-hidden="true">
        <svg className="tasks-doodle tasks-doodle-star-tr" width="54" height="54" viewBox="0 0 54 54" fill="none">
          <path
            d="M27 3L32 18L48 20L36 31L40 47L27 38L14 47L18 31L6 20L22 18L27 3Z"
            fill="#FFE066"
            stroke="#111111"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="27" cy="25" r="2.5" fill="#111111" />
        </svg>

        <svg className="tasks-doodle tasks-doodle-sparkle-l" width="46" height="46" viewBox="0 0 46 46" fill="none">
          <path
            d="M23 4V42M4 23H42M9 9L37 37M9 37L37 9"
            stroke="#FF90E8"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>

        <svg className="tasks-doodle tasks-doodle-swirl-r" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <path
            d="M6 22C6 13 13 6 22 6C31 6 38 13 38 22C38 31 31 38 22 38C15 38 11 32 11 26C11 20 17 16 23 16"
            stroke="#B8F34A"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </svg>

        <svg className="tasks-doodle tasks-doodle-coffee-bl" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <path d="M10 16H30V30C30 33 27 36 23 36H17C13 36 10 33 10 30V16Z" fill="#B79CFF" stroke="#111111" strokeWidth="2.5" />
          <path d="M30 20H35C37 20 38 21 38 23V25C38 27 37 28 35 28H30" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M15 10C15 12 17 13 17 15" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
          <path d="M21 8C21 11 23 12 23 15" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      {/* Hero Header: "Balance without Burnout" */}
      <header className="tasks-feature-header">
        <div className="tasks-header-content">
          <div className="tasks-header-top-row">
            <span className="tasks-header-tag">
              <Zap size={13} strokeWidth={2.5} />
              Orbit Task Engine
            </span>
          </div>
          <h1 className="tasks-title">Balance without Burnout</h1>
          <p className="tasks-subtitle">
            More commitments? Sudden deadline? New hobby? We can find a way to do it all.
          </p>
        </div>

        <button
          type="button"
          className="pop-btn pop-btn-lime"
          onClick={handleUpdateSchedule}
          disabled={submitting}
          title="Regenerate today's plan with current tasks"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="spin" strokeWidth={2.2} />
              <span>Updating…</span>
            </>
          ) : (
            <>
              <span>Update My Plan</span>
              <ArrowRight size={16} strokeWidth={2.2} />
            </>
          )}
        </button>
      </header>

      {message && (
        <div
          style={{
            background: 'var(--pop-lime)',
            border: 'var(--pop-border)',
            borderRadius: 'var(--pop-radius-sm)',
            padding: '12px 16px',
            boxShadow: 'var(--pop-shadow-sm)',
            fontWeight: 700,
            fontSize: '14px',
            color: '#111111',
            zIndex: 1,
          }}
          role="status"
        >
          {message}
        </div>
      )}

      {error && (
        <div className="pop-error-banner" role="alert" style={{ zIndex: 1 }}>
          <AlertTriangle size={18} strokeWidth={2.5} />
          <span>{error}</span>
        </div>
      )}

      {/* Two-Column Grid with Equal-Width Cards */}
      <div className="tasks-entry-grid">
        {/* Left: "What’s new?" (Yellow #FFE066 card with natural-language text area & lime action) */}
        <div className="tasks-grid-card card-whats-new">
          <div className="tasks-card-header">
            <div className="tasks-card-title-wrap">
              <h2 className="tasks-card-title">What’s new?</h2>
              <p className="tasks-card-subtitle">
                Describe a sudden assignment or deadline in your own words.
              </p>
            </div>
            <span className="tasks-card-badge">
              <Sparkles size={11} strokeWidth={2.2} />
              Quick Add
            </span>
          </div>

          <form onSubmit={handleQuickAdd} className="tasks-quick-entry-form">
            <textarea
              className="tasks-nl-textarea"
              placeholder="DBMS assignment due Friday, about 2 hours..."
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              disabled={submitting}
            />

            <div className="tasks-quick-action-row">
              <span className="tasks-parse-notice">
                Adds as a Need To deadline task
              </span>
              <button
                type="submit"
                className="tasks-action-btn-lime"
                disabled={submitting || !nlText.trim()}
              >
                {submitting ? (
                  <>
                    <Loader2 size={15} className="spin" strokeWidth={2.2} />
                    <span>Adding…</span>
                  </>
                ) : (
                  <>
                    <span>Add Task</span>
                    <ArrowRight size={15} strokeWidth={2.2} />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Right: "Prefer more control?" (Lavender #B79CFF card with structured fields & black action) */}
        <div className="tasks-grid-card card-more-control">
          <div className="tasks-card-header">
            <div className="tasks-card-title-wrap">
              <h2 className="tasks-card-title">Prefer more control?</h2>
              <p className="tasks-card-subtitle">
                Set exact parameters, estimated duration, and due dates.
              </p>
            </div>
            <span className="tasks-card-badge">
              <Plus size={11} strokeWidth={2.2} />
              Structured
            </span>
          </div>

          <form onSubmit={handleStructuredAdd} className="tasks-control-form">
            <div className="tasks-control-field">
              <label htmlFor="ctrl-title" className="tasks-control-label">
                Task Name *
              </label>
              <input
                id="ctrl-title"
                type="text"
                className="tasks-control-input"
                placeholder="e.g. Physiology Notes Revision"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                disabled={submitting}
              />
            </div>

            <div className="tasks-control-row-2">
              <div className="tasks-control-field">
                <label htmlFor="ctrl-duration" className="tasks-control-label">
                  <Clock size={12} strokeWidth={2.2} />
                  Duration (mins) *
                </label>
                <input
                  id="ctrl-duration"
                  type="number"
                  step="5"
                  min="5"
                  max="480"
                  className="tasks-control-input"
                  value={form.estimated_duration}
                  onChange={(e) => setForm({ ...form, estimated_duration: Number(e.target.value) })}
                  required
                  disabled={submitting}
                />
              </div>

              <div className="tasks-control-field">
                <label htmlFor="ctrl-deadline" className="tasks-control-label">
                  <Calendar size={12} strokeWidth={2.2} />
                  Due Date *
                </label>
                <input
                  id="ctrl-deadline"
                  type="datetime-local"
                  className="tasks-control-input"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  required
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="tasks-control-field">
              <label htmlFor="ctrl-note" className="tasks-control-label">
                Orbit Instructions (Optional)
              </label>
              <input
                id="ctrl-note"
                type="text"
                className="tasks-control-input"
                placeholder="e.g. Prefer mornings, split across two blocks"
                value={form.natural_language_note}
                onChange={(e) => setForm({ ...form, natural_language_note: e.target.value })}
                disabled={submitting}
              />
            </div>

            <button
              type="submit"
              className="tasks-action-btn-black"
              disabled={submitting || !form.title.trim() || !form.deadline}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="spin" strokeWidth={2.2} />
                  <span>Adding…</span>
                </>
              ) : (
                <>
                  <span>Add Task</span>
                  <ArrowRight size={15} strokeWidth={2.2} />
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* "On your plate" Section: Full-width spanning both columns */}
      <div className="tasks-plate-section">
        <div className="tasks-plate-header">
          <h2 className="tasks-plate-title">
            <span>On your plate</span>
            <span className="tasks-plate-count-badge">
              {plateTasks.length} Need To deadline{plateTasks.length !== 1 ? 's' : ''}
            </span>
          </h2>
        </div>

        {loading && (
          <div style={{ color: '#D6D6D6', fontSize: '14px', fontWeight: 600 }}>
            Loading tasks…
          </div>
        )}

        {!loading && plateTasks.length === 0 && (
          <div className="tasks-plate-empty">
            <div className="tasks-plate-empty-icon">
              <CheckCircle2 size={28} strokeWidth={2.5} style={{ color: '#166451' }} />
            </div>
            <h3 className="tasks-plate-empty-title">Nothing on your plate</h3>
            <p className="tasks-plate-empty-sub">
              No active "Need To" deadline tasks right now. Add assignments or upcoming deadlines above to balance your week.
            </p>
          </div>
        )}

        {!loading && plateTasks.length > 0 && (
          <div className="tasks-plate-grid">
            {plateTasks.map((t, idx) => {
              const colorClass = pastelClasses[idx % pastelClasses.length];

              return (
                <div key={t.id} className={`tasks-plate-card ${colorClass}`}>
                  <div className="tasks-plate-card-info">
                    <div className="tasks-plate-card-top">
                      <span className="tasks-plate-card-title">{t.title}</span>
                      <span className="tasks-plate-pill priority-high">
                        Need To
                      </span>
                    </div>

                    <div className="tasks-plate-card-meta">
                      <span>{t.estimated_duration || t.duration} mins</span>
                      <span>·</span>
                      <span>
                        Due {new Date(t.deadline).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}{t.deadline.includes('T') ? ` at ${formatTime12(t.deadline)}` : ''}
                      </span>
                    </div>

                    {t.natural_language_note && (
                      <div className="tasks-plate-card-note">
                        "{t.natural_language_note}"
                      </div>
                    )}

                    {t.semantic_preferences?.summary && (
                      <div className="tasks-plate-card-semantic">
                        <Sparkles size={11} strokeWidth={2.2} />
                        <span>{t.semantic_preferences.summary}</span>
                      </div>
                    )}
                  </div>

                  <div className="tasks-plate-card-actions">
                    <button
                      type="button"
                      className="tasks-delete-btn"
                      onClick={() => handleCompleteTask(t)}
                      title={`Mark "${t.title}" complete`}
                      aria-label={`Mark ${t.title} complete`}
                    >
                      <Check size={16} strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      className="tasks-delete-btn"
                      onClick={() => handleDeleteTask(t.id)}
                      title={`Delete "${t.title}"`}
                      aria-label={`Delete ${t.title}`}
                    >
                      <Trash2 size={16} strokeWidth={2.2} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default Tasks;
