import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Lock,
  BookOpen,
  CheckSquare,
  Coffee,
  Moon,
  Sparkles,
  CornerDownRight,
  Plus,
  RefreshCw,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import { getSchedule, generateSchedule, errText } from '../api/client';
import './Today.css';

/* Helper functions for dates & times */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function calcMinutes(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return Math.round((e - s) / 60000);
}

function formatDuration(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function Today() {
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => ymd(new Date()));

  // Load schedule for selected date asynchronously
  useEffect(() => {
    let active = true;
    const fetchSchedule = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getSchedule(selectedDate);
        if (active) setSchedule(data);
      } catch (err) {
        if (active) setError(errText(err));
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchSchedule();
    return () => {
      active = false;
    };
  }, [selectedDate]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const data = await generateSchedule(selectedDate);
      setSchedule(data);
    } catch (err) {
      setError(errText(err));
    } finally {
      setGenerating(false);
    }
  };

  // Day tabs (Today, Tomorrow, +2 days)
  const dayTabs = useMemo(() => {
    const list = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const str = ymd(d);
      const weekday = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' });
      const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      list.push({ dateStr: str, weekday, dateLabel });
    }
    return list;
  }, []);

  // Compute stats for current schedule
  const items = schedule?.items || [];
  const deepWorkMins = items
    .filter((i) => i.kind === 'deep' && i.status !== 'displaced')
    .reduce((acc, i) => acc + calcMinutes(i.start_time, i.end_time), 0);
  const totalStudyMins = items
    .filter((i) => (i.kind === 'deep' || i.kind === 'short') && i.status !== 'displaced')
    .reduce((acc, i) => acc + calcMinutes(i.start_time, i.end_time), 0);
  const displacedCount = items.filter((i) => i.displacement_reason).length;

  // Render Kind Icon & Tag
  const renderKindBadge = (kind, displaced) => {
    if (displaced) {
      return <span className="tag">Rescheduled</span>;
    }
    switch (kind) {
      case 'fixed':
        return <span className="tag">Fixed</span>;
      case 'deep':
        return <span className="tag tag-accent">Deep Work</span>;
      case 'short':
        return <span className="tag">Focused</span>;
      case 'break':
        return <span className="tag tag-sage">Recovery</span>;
      case 'decompression':
        return <span className="tag">Skippable</span>;
      default:
        return null;
    }
  };

  const getKindIcon = (kind) => {
    switch (kind) {
      case 'fixed':
        return <Lock size={14} className="timeline-kind-icon" strokeWidth={1.5} />;
      case 'deep':
        return <BookOpen size={14} className="timeline-kind-icon" strokeWidth={1.5} style={{ color: 'var(--accent)' }} />;
      case 'short':
        return <CheckSquare size={14} className="timeline-kind-icon" strokeWidth={1.5} />;
      case 'break':
        return <Coffee size={14} className="timeline-kind-icon" strokeWidth={1.5} style={{ color: 'var(--sage)' }} />;
      case 'decompression':
        return <Moon size={14} className="timeline-kind-icon" strokeWidth={1.5} />;
      default:
        return null;
    }
  };

  return (
    <div className="today-page">
      {/* Header */}
      <div className="today-header">
        <div className="today-header-left">
          <span className="today-date-badge">
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </span>
          <h1 className="today-title">Your Daily Rhythm</h1>
          <div className="today-summary">
            <span>{formatDuration(totalStudyMins)} planned study</span>
            <span>·</span>
            <span>{formatDuration(deepWorkMins)} deep focus</span>
            {displacedCount > 0 && (
              <>
                <span>·</span>
                <span className="text-muted">{displacedCount} block{displacedCount > 1 ? 's' : ''} reorganised</span>
              </>
            )}
          </div>
        </div>

        <div className="today-header-actions">
          <Link to="/changed" className="btn btn-primary">
            <Sparkles size={15} strokeWidth={1.5} />
            <span>Something changed?</span>
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleGenerate}
            disabled={generating || loading}
            aria-label="Recalculate day"
            title="Recalculate day"
          >
            <RefreshCw size={14} strokeWidth={1.5} className={generating ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--error)', fontSize: 'var(--text-xs)' }}>
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Day Selector Tabs */}
      <div className="today-tabs" role="tablist" aria-label="Schedule dates">
        {dayTabs.map((tab) => (
          <button
            key={tab.dateStr}
            type="button"
            role="tab"
            aria-selected={selectedDate === tab.dateStr}
            className={`today-tab-btn ${selectedDate === tab.dateStr ? 'active' : ''}`}
            onClick={() => setSelectedDate(tab.dateStr)}
          >
            <span className="today-tab-weekday">{tab.weekday}</span>
            <span className="today-tab-date">{tab.dateLabel}</span>
          </button>
        ))}
      </div>

      {/* Loading Skeletons */}
      {loading && (
        <div className="timeline-container" style={{ marginTop: 'var(--space-4)' }}>
          <div className="skeleton-box" style={{ height: '80px' }} />
          <div className="skeleton-box" style={{ height: '110px' }} />
          <div className="skeleton-box" style={{ height: '70px' }} />
          <div className="skeleton-box" style={{ height: '90px' }} />
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="today-empty">
          <BookOpen size={36} strokeWidth={1.5} style={{ color: 'var(--ink-muted)' }} />
          <h2 className="today-empty-title">Nothing planned yet</h2>
          <p className="today-empty-desc">
            Add your assignments and fixed commitments, or generate a fresh schedule from your preferences.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-primary" onClick={handleGenerate}>
              <RefreshCw size={14} strokeWidth={1.5} />
              <span>Generate Today's Plan</span>
            </button>
            <Link to="/tasks" className="btn btn-secondary">
              <Plus size={14} strokeWidth={1.5} />
              <span>Add a Task</span>
            </Link>
          </div>
        </div>
      )}

      {/* Vertical Timeline */}
      {!loading && items.length > 0 && (
        <div className="timeline-container">
          <div className="timeline-track-line" />

          {items.map((item, index) => {
            const isDisplaced = !!item.displacement_reason;
            const duration = calcMinutes(item.start_time, item.end_time);

            return (
              <div key={item.id || index} className="timeline-item">
                <div className="timeline-time-label">
                  <div>{formatTime(item.start_time)}</div>
                  <div style={{ fontSize: '10px', opacity: 0.7 }}>
                    {formatTime(item.end_time)}
                  </div>
                </div>

                <div
                  className={`timeline-card timeline-card-${item.kind} ${
                    isDisplaced ? 'timeline-card-displaced' : ''
                  }`}
                >
                  <div className="timeline-card-header">
                    <div className="timeline-title-row">
                      {getKindIcon(item.kind)}
                      <h3 className="timeline-title">{item.title}</h3>
                      {renderKindBadge(item.kind, isDisplaced)}
                    </div>
                    <span className="timeline-meta">{formatDuration(duration)}</span>
                  </div>

                  {/* Calm displacement reason */}
                  {isDisplaced && (
                    <div className="timeline-displacement-note">
                      <CornerDownRight size={13} strokeWidth={1.5} />
                      <span>{item.displacement_reason}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Daily Feedback prompt footer */}
      <div className="today-feedback-banner">
        <div>
          <div style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)', marginBottom: '2px' }}>
            Daily Reflection
          </div>
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
            How did your schedule feel today? Orbit adapts future rhythms based on your energy.
          </div>
        </div>
        <Link to="/changed" className="btn btn-secondary" style={{ fontSize: 'var(--text-xs)' }}>
          <MessageSquare size={13} strokeWidth={1.5} />
          <span>Reflect on Today</span>
        </Link>
      </div>
    </div>
  );
}

export default Today;
