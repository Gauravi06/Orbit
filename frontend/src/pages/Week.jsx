import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  Sparkles,
  Heart,
  ChevronLeft,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import { getWeekSpread } from '../api/client';
import './Week.css';

export function Week() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    let active = true;
    const fetchWeek = async () => {
      setLoading(true);
      try {
        const res = await getWeekSpread(currentDate);
        if (active) setData(res);
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchWeek();
    return () => {
      active = false;
    };
  }, [currentDate]);

  const handlePrevWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    setCurrentDate(d.toISOString().split('T')[0]);
  };

  const handleNextWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    setCurrentDate(d.toISOString().split('T')[0]);
  };

  const days = data?.days || [];
  const groups = data?.groups || [];

  return (
    <div className="week-page">
      {/* Editorial Header */}
      <div className="week-header">
        <div>
          <span className="week-badge">CALM WEEKLY SPREAD</span>
          <h1 className="week-title">Your Week in Orbit</h1>
          <p className="week-subtitle">
            A quiet reflection on closed days. No streaks, no scores, just what happened and how you spent your energy.
          </p>
        </div>

        <div className="week-nav-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePrevWeek}
            aria-label="Previous week"
          >
            <ChevronLeft size={15} strokeWidth={1.5} />
            <span>Earlier</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleNextWeek}
            aria-label="Next week"
          >
            <span>Later</span>
            <ChevronRight size={15} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="week-loading-card">
          <div className="skeleton-box" style={{ height: '140px' }} />
          <div className="skeleton-box" style={{ height: '180px' }} />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Day column headers for the 7 small circles */}
          <div className="week-card">
            <div className="week-table-header">
              <span className="week-table-col-label">HABIT / STUDY FOCUS</span>
              <div className="week-days-row">
                {days.map((day) => (
                  <div key={day.date} className="week-day-col">
                    <span className="week-day-name">{day.weekday}</span>
                    <span className="week-day-date">{day.date.split('-')[2]}</span>
                    {!day.is_closed && (
                      <span className="week-open-pill" title="Day not closed yet">open</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Habit & Task Rows */}
            <div className="week-groups-list">
              {groups.map((group) => (
                <div key={group.title} className="week-group-row">
                  <div className="week-group-info">
                    <span className="week-group-name">{group.title}</span>
                    <p className="week-group-sentence">{group.sentence}</p>
                  </div>

                  <div className="week-circles-row">
                    {group.circles.map((state, idx) => (
                      <div
                        key={idx}
                        className={`week-circle week-circle-${state}`}
                        title={
                          state === 'done'
                            ? 'Completed on closed day'
                            : state === 'moved'
                            ? 'Rescheduled / Moved'
                            : state === 'unclosed'
                            ? 'Day not closed yet'
                            : 'No session planned'
                        }
                        aria-label={`${days[idx]?.weekday}: ${state}`}
                      >
                        {state === 'done' && <CheckCircle2 size={12} strokeWidth={2} />}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Circle Legend */}
            <div className="week-legend">
              <div className="week-legend-item">
                <div className="week-circle week-circle-done" style={{ width: 14, height: 14 }} />
                <span>Completed</span>
              </div>
              <div className="week-legend-item">
                <div className="week-circle week-circle-moved" style={{ width: 14, height: 14 }} />
                <span>Moved to another day</span>
              </div>
              <div className="week-legend-item">
                <div className="week-circle week-circle-unclosed" style={{ width: 14, height: 14 }} />
                <span>Day still open</span>
              </div>
            </div>
          </div>

          {/* Time & Balance Lines */}
          <div className="week-stats-grid">
            <div className="week-stat-card">
              <div className="week-stat-header">
                <Clock size={16} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                <span className="week-stat-title">Deep Work</span>
              </div>
              <div className="week-stat-value">{data.deepWorkHours} hours</div>
              <p className="week-stat-desc">
                Dedicated focus sessions completed across closed days.
              </p>
            </div>

            <div className="week-stat-card">
              <div className="week-stat-header">
                <Heart size={16} strokeWidth={1.5} style={{ color: 'var(--sage)' }} />
                <span className="week-stat-title">Rest & Breaks</span>
              </div>
              <div className="week-stat-value">{data.restHours} hours</div>
              <p className="week-stat-desc">
                Protected meals, decompression cushions, and recovery windows.
              </p>
            </div>

            <div className="week-stat-card">
              <div className="week-stat-header">
                <Sparkles size={16} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                <span className="week-stat-title">Protected Hobby Time</span>
              </div>
              <div className="week-stat-value">
                {data.hobbyHours}h <span className="week-stat-sub">/ {data.targetHobbyHours}h goal</span>
              </div>
              <p className="week-stat-desc">
                Like-to creative time guarded against schedule overflow.
              </p>
            </div>
          </div>

          {/* "What Orbit noticed" Section */}
          <div className="week-reflection-card">
            <div className="week-reflection-header">
              <BookOpen size={18} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
              <h2 className="week-reflection-title">What Orbit noticed</h2>
            </div>
            <p className="week-reflection-p">{data.noticeParagraph}</p>
            <div className="week-suggestion-box">
              <span className="week-suggestion-badge">Suggestion</span>
              <p className="week-suggestion-text">{data.suggestion}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Week;
