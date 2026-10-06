import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Lock,
  Sparkles,
} from 'lucide-react';
import { getTasks, createTask, generateSchedule, errText } from '../api/client';
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
    category: 'academic',
    task_type: 'deadline',
    priority: 3,
    estimated_duration: 90,
    deadline: '',
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

    let duration = 90;
    let priority = 3;
    let category = 'academic';

    const lower = quickText.toLowerCase();
    if (lower.includes('1h') || lower.includes('60m')) duration = 60;
    if (lower.includes('2h') || lower.includes('120m')) duration = 120;
    if (lower.includes('3h') || lower.includes('180m')) duration = 180;
    if (lower.includes('45m')) duration = 45;

    if (lower.includes('urgent') || lower.includes('tomorrow') || lower.includes('exam')) {
      priority = 5;
    } else if (lower.includes('gym') || lower.includes('workout')) {
      category = 'health';
      priority = 3;
    }

    setForm({
      ...form,
      title: quickText.trim(),
      estimated_duration: duration,
      priority,
      category,
    });
    setActiveTab('task');
    setMessage(`Form populated with guess for "${quickText.trim()}". Adjust details and click Add.`);
    setQuickText('');
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const payload = {
        title: form.title.trim(),
        category: form.category,
        task_type: form.task_type,
        priority: Number(form.priority),
        estimated_duration: Number(form.estimated_duration),
        deadline: form.deadline ? `${form.deadline}:00` : null,
        is_fixed: false,
      };

      await createTask(payload);
      setMessage('Task added. It will be scheduled in your next plan.');
      setForm({
        title: '',
        category: 'academic',
        task_type: 'deadline',
        priority: 3,
        estimated_duration: 90,
        deadline: '',
      });
      await loadTasksData();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSubmitting(false);
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

      {/* Quick Add NLP Guess Box */}
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
            placeholder='e.g. "OS lab report 2h due Friday" or "Maths problem set 90m"'
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
                <label htmlFor="task-title">Task Title</label>
                <input
                  id="task-title"
                  type="text"
                  className="input"
                  placeholder="e.g. Distributed Systems Homework"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div className="form-group">
                  <label htmlFor="task-type">Type</label>
                  <select
                    id="task-type"
                    className="input"
                    value={form.task_type}
                    onChange={(e) => setForm({ ...form, task_type: e.target.value })}
                  >
                    <option value="deadline">Deadline</option>
                    <option value="growth">Growth (Ongoing)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="task-category">Category</label>
                  <select
                    id="task-category"
                    className="input"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    <option value="academic">Academic</option>
                    <option value="health">Health</option>
                    <option value="personal">Personal</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="task-priority">
                  Priority (1 to 5)
                </label>
                <select
                  id="task-priority"
                  className="input"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                >
                  <option value={5}>5 — Critical / Imminent deadline</option>
                  <option value={4}>4 — High priority coursework</option>
                  <option value={3}>3 — Standard study session</option>
                  <option value={2}>2 — Review & light revision</option>
                  <option value={1}>1 — Optional / extra credit</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="task-duration">Estimated Duration (minutes)</label>
                <input
                  id="task-duration"
                  type="number"
                  step="15"
                  min="15"
                  className="input"
                  value={form.estimated_duration}
                  onChange={(e) => setForm({ ...form, estimated_duration: Number(e.target.value) })}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="task-deadline">Deadline (optional for Growth)</label>
                <input
                  id="task-deadline"
                  type="datetime-local"
                  className="input"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                />
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
                  placeholder="e.g. Chemistry Lab, Gym, Club"
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
                  step="15"
                  min="15"
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

            {plainList.map((t) => (
              <div key={t.id} className="tasks-item-card">
                <div className="tasks-item-info">
                  <div className="tasks-item-title">{t.title}</div>
                  <div className="tasks-item-meta">
                    <span className={`priority-badge ${t.priority >= 4 ? 'p5' : ''}`}>
                      P{t.priority}
                    </span>
                    <span>{t.estimated_duration} mins</span>
                    <span>·</span>
                    <span style={{ textTransform: 'capitalize' }}>{t.category}</span>
                    {t.deadline && (
                      <>
                        <span>·</span>
                        <span>Due {new Date(t.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
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
                    <span>{f.estimated_duration} mins</span>
                    {f.deadline && (
                      <>
                        <span>·</span>
                        <span>{new Date(f.deadline).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Tasks;
