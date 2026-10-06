import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Lock,
  Sparkles,
  Trash2,
  Plus,
  Clock,
  Calendar,
} from 'lucide-react';
import { getTasks, createTask, deleteTask, generateSchedule, errText, parseTaskSemantics } from '../api/client';
import './Tasks.css';

export function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('task'); // 'task' | 'fixed'

  // Quick add input
  const [quickText, setQuickText] = useState('');

  // Form states
  const [form, setForm] = useState({
    title: '',
    tier: 'have_to', // 'have_to' (Need To) | 'need_to' (Should Do) | 'like_to' (Like To)
    estimated_duration: 60,
    frequency: 'One-time',
    weekly_day: 'Tuesday',
    deadline: '',
    natural_language_note: '',
  });

  const [fixedForm, setFixedForm] = useState({
    title: '',
    category: 'academic',
    date: new Date().toISOString().split('T')[0],
    time: '09:00',
    estimated_duration: 180,
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

  // Quick smart guess parser
  const handleQuickAdd = (e) => {
    e.preventDefault();
    if (!quickText.trim()) return;

    const parsed = parseTaskSemantics(quickText);
    const duration = parsed.estimated_duration || 60;
    const tier = parsed.tier || 'have_to';
    const frequency = parsed.frequency || 'One-time';

    // Extract clean title from beginning before punctuation/keywords
    let title = quickText.trim();
    const parts = quickText.split(/[,;\-–]/);
    if (parts.length > 1 && parts[0].trim().length > 1) {
      title = parts[0].trim();
    }

    setForm({
      title,
      estimated_duration: duration,
      tier,
      frequency,
      weekly_day: 'Tuesday',
      deadline: '',
      natural_language_note: quickText.trim(),
    });
    setActiveTab('task');
    const tierLabel = tier === 'have_to' ? 'Need To' : tier === 'like_to' ? 'Like To' : 'Should Do';
    setMessage(`Parsed "${title}" as ${tierLabel} · ${duration} mins · ${frequency}. Review and click Add Task.`);
    setQuickText('');
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const parsed = form.natural_language_note.trim()
        ? parseTaskSemantics(form.natural_language_note.trim(), form)
        : null;

      let effectiveDuration = Number(form.estimated_duration) || 60;
      let effectiveFrequency = form.frequency || 'One-time';
      let effectiveTier = form.tier || 'have_to';

      if (parsed && !parsed.isEmpty) {
        if (parsed.estimated_duration && (!form.estimated_duration || form.estimated_duration === 60)) {
          effectiveDuration = parsed.estimated_duration;
        }
      }

      const freqLower = (effectiveFrequency || '').toLowerCase().trim();
      const isExplicitRecurring =
        freqLower === 'daily' ||
        freqLower === 'every day' ||
        freqLower === 'everyday' ||
        freqLower === 'weekdays' ||
        freqLower === 'weekends' ||
        freqLower === 'weekly' ||
        freqLower === '2x a week' ||
        freqLower === '2-3x a week' ||
        freqLower === '3-4x a week' ||
        freqLower === 'regularly' ||
        freqLower === 'recurring';

      // RULE 1: Tasks are One-time by default unless explicit recurrence was chosen
      const finalFrequency = isExplicitRecurring ? effectiveFrequency : 'One-time';
      const taskType = isExplicitRecurring ? 'growth' : 'deadline';

      const payload = {
        title: form.title.trim(),
        tier: effectiveTier,
        priority: effectiveTier === 'have_to' ? 5 : effectiveTier === 'need_to' ? 3 : 1,
        estimated_duration: effectiveDuration,
        duration: effectiveDuration,
        frequency: finalFrequency,
        task_type: taskType,
        days: finalFrequency === 'Weekly' ? form.weekly_day : null,
        deadline: form.deadline ? form.deadline : null,
        natural_language_note: form.natural_language_note.trim() ? form.natural_language_note.trim() : null,
        semantic_preferences: parsed && !parsed.isEmpty ? parsed : null,
        is_fixed: false,
      };

      await createTask(payload);
      setMessage('Task added. Added to your schedule.');
      setForm({
        title: '',
        tier: 'have_to',
        estimated_duration: 60,
        frequency: 'One-time',
        weekly_day: 'Tuesday',
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

  const handleDeleteTask = async (id) => {
    try {
      await deleteTask(id);
      await loadTasksData();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleAddFixed = async (e) => {
    e.preventDefault();
    if (!fixedForm.title.trim()) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        title: fixedForm.title.trim(),
        category: fixedForm.category,
        task_type: 'fixed',
        priority: 3,
        estimated_duration: Number(fixedForm.estimated_duration),
        deadline: `${fixedForm.date}T${fixedForm.time}:00`,
        is_fixed: true,
      };

      await createTask(payload);
      setMessage('Fixed commitment saved.');
      await loadTasksData();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSubmitting(false);
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

  const fixedList = tasks.filter((t) => t.is_fixed);
  const plainList = tasks.filter((t) => !t.is_fixed);

  return (
    <div className="tasks-page">
      {/* Header */}
      <div className="tasks-header">
        <div>
          <h1 className="tasks-title">Tasks & Commitments</h1>
          <p className="tasks-subtitle">
            Manage your assignments, study goals, and fixed schedules.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleUpdateSchedule}
          disabled={submitting}
        >
          {submitting ? 'Updating…' : 'Update My Plan'}
        </button>
      </div>

      {message && (
        <div style={{ backgroundColor: 'var(--sage-bg)', border: '1px solid var(--sage)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>
          {message}
        </div>
      )}

      {error && (
        <div className="form-error" style={{ fontSize: 'var(--text-sm)' }}>
          {error}
        </div>
      )}

      {/* Quick Add Guess Box */}
      <div className="tasks-quick-box">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Sparkles size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Quick Add
          </span>
        </div>
        <form onSubmit={handleQuickAdd} className="tasks-quick-form">
          <input
            type="text"
            className="input"
            placeholder='e.g. "Problem Set 60m due Friday" or "Reading 30m Daily"'
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary" style={{ flexShrink: 0 }}>
            Fill Form
          </button>
        </form>
      </div>

      {/* Main Grid: Form Left, Lists Right */}
      <div className="tasks-grid">
        {/* Form Card */}
        <div className="tasks-form-card">
          <div className="tasks-form-tabs">
            <button
              type="button"
              className={`tasks-form-tab ${activeTab === 'task' ? 'active' : ''}`}
              onClick={() => setActiveTab('task')}
            >
              Study Task
            </button>
            <button
              type="button"
              className={`tasks-form-tab ${activeTab === 'fixed' ? 'active' : ''}`}
              onClick={() => setActiveTab('fixed')}
            >
              Fixed Commitment
            </button>
          </div>

          {activeTab === 'task' ? (
            <form onSubmit={handleAddTask} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label htmlFor="task-title">Task Name</label>
                <input
                  id="task-title"
                  type="text"
                  className="input"
                  placeholder="e.g. Physiology Notes Revision"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div className="form-group">
                  <label htmlFor="task-duration">Duration (mins)</label>
                  <input
                    id="task-duration"
                    type="number"
                    step="5"
                    min="5"
                    max="480"
                    className="input"
                    value={form.estimated_duration}
                    onChange={(e) => setForm({ ...form, estimated_duration: Number(e.target.value) })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="task-tier">Priority</label>
                  <select
                    id="task-tier"
                    className="input"
                    value={form.tier}
                    onChange={(e) => setForm({ ...form, tier: e.target.value })}
                  >
                    <option value="have_to">Need To (High)</option>
                    <option value="need_to">Should Do (Medium)</option>
                    <option value="like_to">Like To (Protected Hobby)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="task-frequency">Frequency</label>
                <select
                  id="task-frequency"
                  className="input"
                  value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                >
                  <option value="One-time">One-time / One-off</option>
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly (Specific Day)</option>
                  <option value="2x a week">2x a week</option>
                  <option value="2-3x a week">2-3x a week</option>
                  <option value="3-4x a week">3-4x a week</option>
                  <option value="Weekdays">Weekdays only (Mon–Fri)</option>
                  <option value="Weekends">Weekends only (Sat–Sun)</option>
                </select>
              </div>

              {form.frequency === 'Weekly' && (
                <div className="form-group">
                  <label htmlFor="task-weekly-day">Select Day of Week</label>
                  <select
                    id="task-weekly-day"
                    className="input"
                    value={form.weekly_day}
                    onChange={(e) => setForm({ ...form, weekly_day: e.target.value })}
                  >
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                    <option value="Sunday">Sunday</option>
                  </select>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="task-deadline">Deadline (Optional)</label>
                <input
                  id="task-deadline"
                  type="datetime-local"
                  className="input"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label htmlFor="task-note">Anything Orbit should know? (Optional)</label>
                <textarea
                  id="task-note"
                  className="input"
                  rows={3}
                  placeholder="e.g. Prefer mornings, split this into two blocks, avoid doing this after college..."
                  value={form.natural_language_note}
                  onChange={(e) => setForm({ ...form, natural_language_note: e.target.value })}
                />
                <div style={{ marginTop: 'var(--space-2)' }}>
                  {form.natural_language_note.trim() ? (
                    (() => {
                      const parsed = parseTaskSemantics(form.natural_language_note, form);
                      return parsed.summary ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--sage-dark, #2b6cb0)',
                            backgroundColor: 'var(--sage-bg, #ebf8ff)',
                            padding: '6px 10px',
                            borderRadius: 'var(--radius-sm, 6px)',
                            border: '1px solid var(--border-color, #bee3f8)',
                          }}
                        >
                          <Sparkles size={13} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--primary, #3182ce)' }} />
                          <span><strong>Orbit understood:</strong> {parsed.summary}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted, #718096)', padding: '2px 0' }}>
                          Orbit will use your usual planning preferences.
                        </div>
                      );
                    })()
                  ) : (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted, #718096)', padding: '2px 0' }}>
                      Orbit will use your usual planning preferences.
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
                style={{ marginTop: 'var(--space-2)' }}
              >
                {submitting ? 'Adding…' : 'Add Task'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAddFixed} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label htmlFor="fixed-title">Commitment Name</label>
                <input
                  id="fixed-title"
                  type="text"
                  className="input"
                  placeholder="e.g. Morning Hospital Shift, Physics Lab"
                  value={fixedForm.title}
                  onChange={(e) => setFixedForm({ ...fixedForm, title: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div className="form-group">
                  <label htmlFor="fixed-date">Date</label>
                  <input
                    id="fixed-date"
                    type="date"
                    className="input"
                    value={fixedForm.date}
                    onChange={(e) => setFixedForm({ ...fixedForm, date: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="fixed-time">Start Time</label>
                  <input
                    id="fixed-time"
                    type="time"
                    className="input"
                    value={fixedForm.time}
                    onChange={(e) => setFixedForm({ ...fixedForm, time: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="fixed-duration">Duration (minutes)</label>
                <input
                  id="fixed-duration"
                  type="number"
                  step="5"
                  min="5"
                  max="480"
                  className="input"
                  value={fixedForm.estimated_duration}
                  onChange={(e) => setFixedForm({ ...fixedForm, estimated_duration: Number(e.target.value) })}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
                style={{ marginTop: 'var(--space-2)' }}
              >
                {submitting ? 'Saving…' : 'Add Fixed Commitment'}
              </button>
            </form>
          )}
        </div>

        {/* Lists Column */}
        <div className="tasks-list-col">
          {/* Plain Tasks Section */}
          <div className="tasks-section">
            <div className="tasks-section-header">
              <h2 className="tasks-section-title">Assignments & Study Goals ({plainList.length})</h2>
            </div>

            {loading && <div className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>Loading tasks…</div>}

            {!loading && plainList.length === 0 && (
              <div className="text-muted" style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0' }}>
                No active tasks yet. Use the form on the left to add one.
              </div>
            )}

            {plainList.map((t) => {
              const tierLabel = t.tier === 'have_to' ? 'Need To' : t.tier === 'like_to' ? 'Like To' : 'Should Do';
              const tierClass = t.tier === 'have_to' ? 'p5' : '';
              return (
                <div key={t.id} className="tasks-item-card">
                  <div className="tasks-item-info">
                    <div className="tasks-item-title">{t.title}</div>
                    <div className="tasks-item-meta">
                      <span className={`priority-badge ${tierClass}`}>
                        {tierLabel}
                      </span>
                      <span>{t.estimated_duration || t.duration} mins</span>
                      <span>·</span>
                      <span>{t.frequency || 'One-time'}{t.days ? ` (${t.days})` : ''}</span>
                      {t.deadline && (
                        <>
                          <span>·</span>
                          <span>Due {new Date(t.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </>
                      )}
                    </div>
                    {t.natural_language_note && (
                      <div style={{ fontSize: '11px', color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 'var(--space-1)' }}>
                        "{t.natural_language_note}"
                      </div>
                    )}
                    {t.semantic_preferences?.summary && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--primary, #2b6cb0)', backgroundColor: 'var(--sage-bg, #ebf8ff)', padding: '2px 6px', borderRadius: '4px', marginTop: '4px' }}>
                        <Sparkles size={10} strokeWidth={2} />
                        <span>{t.semantic_preferences.summary}</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', color: 'var(--ink-muted)', height: 'auto' }}
                    onClick={() => handleDeleteTask(t.id)}
                    aria-label={`Delete ${t.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Fixed Commitments Section */}
          <div className="tasks-section">
            <div className="tasks-section-header">
              <h2 className="tasks-section-title">Fixed Commitments ({fixedList.length})</h2>
            </div>

            {fixedList.map((f) => (
              <div key={f.id} className="tasks-item-card" style={{ backgroundColor: 'var(--surface-2)' }}>
                <div className="tasks-item-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Lock size={13} strokeWidth={1.5} style={{ color: 'var(--ink-muted)' }} />
                    <span className="tasks-item-title">{f.title}</span>
                  </div>
                  <div className="tasks-item-meta">
                    <span>{f.estimated_duration || f.duration} mins</span>
                    {f.deadline && (
                      <>
                        <span>·</span>
                        <span>{new Date(f.deadline).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '4px 8px', color: 'var(--ink-muted)', height: 'auto' }}
                  onClick={() => handleDeleteTask(f.id)}
                  aria-label={`Delete ${f.title}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Tasks;
