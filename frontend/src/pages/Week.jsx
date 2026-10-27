import { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Clock,
  Sparkles,
  Heart,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Calendar,
  Lock,
  CheckSquare,
  Coffee,
  Moon,
  Check,
  X,
  CornerDownRight,
  AlertCircle,
  Sun,
  Flame,
  Zap,
  Target,
  Compass,
} from 'lucide-react';
import { getWeekSpread, setItemDone, errText } from '../api/client';
import './Week.css';

import { formatTime12 } from '../utils/timeFormat';

/* Helper functions for formatting times & durations */
function formatTime(isoStr) {
  return formatTime12(isoStr);
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

function hoursFromMinutes(minutes) {
  return (minutes / 60).toFixed(1);
}

// 7 deliberate, coordinated sequence colors across the 7 days of the week (Monday -> Sunday)
const DAY_COLOR_CONFIGS = [
  { bg: '#FFE066', name: 'yellow', icon: Sun },       // Mon - Yellow
  { bg: '#FF90E8', name: 'pink', icon: Sparkles },     // Tue - Pink
  { bg: '#B8F34A', name: 'lime', icon: Zap },          // Wed - Lime
  { bg: '#B79CFF', name: 'lavender', icon: Flame },    // Thu - Lavender
  { bg: '#FFE8A3', name: 'warm-cream', icon: Target }, // Fri - Warm Sunshine
  { bg: '#FFB8E8', name: 'rose', icon: Heart },        // Sat - Light Rose
  { bg: '#CEFC7A', name: 'mint-lime', icon: Coffee },  // Sun - Fresh Mint
];

export function Week() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedDayDate, setSelectedDayDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState('');

  const modalRef = useRef(null);
  const closeButtonRef = useRef(null);
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  useEffect(() => {
    let active = true;
    const fetchWeek = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await getWeekSpread(currentDate);
        if (active) {
          setData(res);
          // If selectedDayDate is not in the loaded week days, select today or first day
          if (res?.days?.length > 0) {
            setSelectedDayDate((prev) => {
              const hasSelected = res.days.some((d) => d.date === prev);
              if (!hasSelected) {
                const hasToday = res.days.find((d) => d.date === todayStr);
                return hasToday ? todayStr : res.days[0].date;
              }
              return prev;
            });
          }
        }
      } catch (err) {
        if (active) setError(errText(err));
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchWeek();
    return () => {
      active = false;
    };
  }, [currentDate, todayStr]);

  // Modal keyboard handling (Escape to close, focus management)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isModalOpen) {
        setIsModalOpen(false);
      }
    };

    if (isModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
      // Focus close button on open
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen]);

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

  const handleTodayWeek = () => {
    setCurrentDate(todayStr);
    setSelectedDayDate(todayStr);
  };

  const handleDayCardClick = (date) => {
    setSelectedDayDate(date);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const days = useMemo(() => data?.days || [], [data?.days]);
  const groups = useMemo(() => data?.groups || [], [data?.groups]);

  // DEMO ONLY: set to false to show real calculated values
  const DEMO_MODE = true;

  // Calculate weekly metrics only from the seven days currently displayed.
  // Deep focus counts completed, non-displaced deep-work sessions.
  const weeklyDeepFocusMinutes = days.reduce((total, day) => {
    return total + (day.items || []).reduce((dayTotal, item) => {
      if (
        item.kind === 'deep' &&
        item.done &&
        item.status !== 'displaced' &&
        !item.displacement_reason
      ) {
        return dayTotal + calcMinutes(item.start_time, item.end_time);
      }
      return dayTotal;
    }, 0);
  }, 0);

  // Hobby time counts only short blocks explicitly marked as like-to activities.
  // Ordinary short/focused tasks and open windows are excluded.
  const weeklyProtectedHobbyMinutes = days.reduce((total, day) => {
    return total + (day.items || []).reduce((dayTotal, item) => {
      if (
        item.kind === 'short' &&
        item.tier === 'like_to' &&
        item.status !== 'displaced' &&
        !item.displacement_reason
      ) {
        return dayTotal + calcMinutes(item.start_time, item.end_time);
      }
      return dayTotal;
    }, 0);
  }, 0);

  const deepFocusHours = DEMO_MODE ? '12.5' : hoursFromMinutes(weeklyDeepFocusMinutes);
  const protectedHobbyHours = DEMO_MODE ? '4.5' : hoursFromMinutes(weeklyProtectedHobbyMinutes);
  const deepFocusGoalHours = DEMO_MODE ? 15 : 5;
  const protectedHobbyGoalHours = DEMO_MODE ? 5 : 2;

  // Identify currently selected day from the loaded days array
  const activeDay = useMemo(() => {
    if (!days || days.length === 0) return null;
    return days.find((d) => d.date === selectedDayDate) || days[0];
  }, [days, selectedDayDate]);

  // Toggle task completion within the day schedule
  const handleToggleDone = async (item) => {
    if (item.is_fixed || activeDay?.is_closed) return;
    const nextDone = !item.done;

    // Optimistic update inside local data
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((d) => {
          if (d.date !== selectedDayDate) return d;
          return {
            ...d,
            items: d.items.map((i) => (i.id === item.id ? { ...i, done: nextDone } : i)),
          };
        }),
      };
    });

    try {
      await setItemDone(item.id, nextDone);
    } catch (err) {
      setError(errText(err));
      // Reload on error
      const refreshed = await getWeekSpread(currentDate);
      setData(refreshed);
    }
  };

  const renderKindBadge = (kind, displaced, tier) => {
    if (displaced) {
      return <span className="pop-pill-badge" style={{ background: 'var(--pop-pink)' }}>Rescheduled</span>;
    }
    switch (kind) {
      case 'fixed':
        return <span className="pop-pill-badge" style={{ background: 'var(--pop-yellow)' }}>Fixed</span>;
      case 'deep':
        return <span className="pop-pill-badge" style={{ background: 'var(--pop-pink)' }}>Deep focus</span>;
      case 'short':
        return (
          <span className="pop-pill-badge" style={{ background: 'var(--pop-lime)' }}>
            {tier === 'like_to' ? 'Protected hobby' : 'Focused task'}
          </span>
        );
      case 'break':
        return <span className="pop-pill-badge" style={{ background: 'var(--pop-lavender)' }}>Recovery buffer</span>;
      case 'open':
        return <span className="pop-pill-badge" style={{ background: 'var(--pop-lavender)' }}>Open window</span>;
      case 'routine':
        return <span className="pop-pill-badge" style={{ background: 'var(--pop-lavender)' }}>Meal & routine</span>;
      case 'decompression':
        return <span className="pop-pill-badge" style={{ background: 'var(--pop-yellow)' }}>Wind down</span>;
      default:
        return null;
    }
  };

  const getKindIcon = (kind) => {
    switch (kind) {
      case 'fixed':
        return <Lock size={15} strokeWidth={2.2} />;
      case 'deep':
        return <BookOpen size={15} strokeWidth={2.2} />;
      case 'short':
        return <CheckSquare size={15} strokeWidth={2.2} />;
      case 'break':
        return <Coffee size={15} strokeWidth={2.2} />;
      case 'open':
        return <Sparkles size={15} strokeWidth={2.2} />;
      case 'routine':
        return <Coffee size={15} strokeWidth={2.2} />;
      case 'decompression':
        return <Moon size={15} strokeWidth={2.2} />;
      default:
        return <Clock size={15} strokeWidth={2.2} />;
    }
  };

  // Helper stats for active day
  const activeDayItems = activeDay?.items || [];
  const activeCompletedTasks = activeDayItems.filter((i) => !i.is_fixed && i.done).length;
  const activeRemainingTasks = activeDayItems.filter((i) => !i.is_fixed && !i.done).length;
  const activeTotalStudyMins = activeDayItems
    .filter((i) => (i.kind === 'deep' || i.kind === 'short') && i.status !== 'displaced')
    .reduce((acc, i) => acc + calcMinutes(i.start_time, i.end_time), 0);

  // Distinguish major activities (classes, fixed lectures, deep work, focused assignments)
  const isMajorActivity = (item) => {
    return item.kind === 'deep' || item.kind === 'short' || item.is_fixed;
  };

  return (
    <div className="week-page">
      {/* ------------------------------------------------------------------
         1. Feature Header (Distinct black #111111 background with yellow #FFE066 accent)
         Heading: "Your week, in colour"
         Subtitle: "A Little Structure and Room for Real Life"
         ------------------------------------------------------------------ */}
      <header className="week-feature-header">
        <div className="week-header-content">
          <div className="week-header-top-row">
            <span className="week-header-motif-tag">
              <Calendar size={14} strokeWidth={2.5} />
              Orbit Weekly Spread
            </span>
          </div>

          <div className="week-header-text-block">
            <h1 className="week-feature-heading">Your week, in colour</h1>
            <p className="week-feature-subtitle">A Little Structure and Room for Real Life</p>
          </div>
        </div>

        {/* Intentional open space for future shared design-polish doodles */}
        <div className="week-header-doodle-reserve" aria-hidden="true" />

        {/* Navigation controls integrated neatly with high contrast */}
        <div className="week-header-nav-toolbar">
          <button
            type="button"
            className="pop-btn pop-btn-header-white"
            onClick={handlePrevWeek}
            aria-label="Previous week"
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
            <span>Earlier</span>
          </button>
          <button
            type="button"
            className="pop-btn pop-btn-header-accent"
            onClick={handleTodayWeek}
            aria-label="Jump to current week"
          >
            <span>Current week</span>
          </button>
          <button
            type="button"
            className="pop-btn pop-btn-header-white"
            onClick={handleNextWeek}
            aria-label="Next week"
          >
            <span>Later</span>
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {error && (
        <div className="pop-error-banner" role="alert">
          <AlertCircle size={18} strokeWidth={2.5} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="week-loading-card">
          <div className="pop-skeleton-box" style={{ height: '340px' }} />
          <div className="pop-skeleton-box" style={{ height: '240px' }} />
        </div>
      )}

      {!loading && data && (
        <>
          {/* ------------------------------------------------------------------
             2. Main Weekly Grid (Seven Days as Primary Overview, 3+3+1 Desktop / 2-col Mobile)
             ------------------------------------------------------------------ */}
          <section className="week-grid-section" aria-label="Weekly schedule overview">
            <div className="week-grid-toolbar">
              <span className="week-grid-hint-pill">
                <Compass size={13} strokeWidth={2.5} />
                Tap any day to explore it
              </span>
            </div>

            <div className="week-main-grid" role="tablist" aria-label="Seven days of the week">
              {days.map((day, idx) => {
                const colorConfig = DAY_COLOR_CONFIGS[idx % DAY_COLOR_CONFIGS.length];
                const DayIcon = colorConfig.icon;
                const isSelected = day.date === (activeDay?.date || selectedDayDate);
                const isCurrentToday = day.date === todayStr;

                const dayItems = day.items || [];
                const completedItems = dayItems.filter((i) => !i.is_fixed && i.done);
                const uncompletedItems = dayItems.filter((i) => !i.is_fixed && !i.done);
                const fixedCommitments = dayItems.filter((i) => i.is_fixed);

                // Priority preview items (up to 3 distinct activities)
                const previewItems = dayItems.slice(0, 3);
                const remainingItemCount = dayItems.length - previewItems.length;

                return (
                  <button
                    key={day.date}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`week-day-box ${isSelected ? 'is-selected' : ''} ${
                      isCurrentToday ? 'is-today' : ''
                    } day-idx-${idx}`}
                    style={{ '--day-card-bg': colorConfig.bg }}
                    onClick={() => handleDayCardClick(day.date)}
                  >
                    {/* Top Row: Day Name, Date & Badges */}
                    <div className="week-day-box-header">
                      <div className="week-day-title-wrap">
                        <span className="week-day-box-name">{day.weekday}</span>
                        <span className="week-day-box-date">
                          {new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>

                      <div className="week-day-box-badges">
                        {isCurrentToday && (
                          <span className="week-badge-today">Today</span>
                        )}
                        {day.is_closed && (
                          <span className="week-badge-closed" title="Day closed out">Closed</span>
                        )}
                        <div className="week-day-box-icon" aria-hidden="true">
                          <DayIcon size={16} strokeWidth={2.5} />
                        </div>
                      </div>
                    </div>

                    {/* Compact Activity Previews (Actual schedule data) */}
                    <div className="week-day-preview-list">
                      {previewItems.length === 0 ? (
                        <div className="week-day-empty-preview">Open schedule</div>
                      ) : (
                        previewItems.map((item, itemIdx) => {
                          const isDone = Boolean(item.done);
                          return (
                            <div key={item.id || itemIdx} className="week-day-preview-item">
                              <span className={`preview-item-bullet ${isDone ? 'is-done-bullet' : ''}`} />
                              <span className={`preview-item-title ${isDone ? 'preview-done-text' : ''}`}>
                                {item.title}
                              </span>
                            </div>
                          );
                        })
                      )}

                      {remainingItemCount > 0 && (
                        <div className="week-day-more-indicator">
                          +{remainingItemCount} more activity{remainingItemCount > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>

                    {/* Card Footer: Accurate Completion & Commitment Stats */}
                    <div className="week-day-box-footer">
                      <div className="week-day-metric-group">
                        <span className="metric-chip done-chip">
                          <Check size={11} strokeWidth={3} />
                          {completedItems.length} done
                        </span>
                        {uncompletedItems.length > 0 && (
                          <span className="metric-chip uncompleted-chip">
                            <Clock size={11} strokeWidth={2.5} />
                            {uncompletedItems.length} left
                          </span>
                        )}
                      </div>
                      <span className="week-day-commitments-label">
                        {fixedCommitments.length > 0
                          ? `${fixedCommitments.length} fixed`
                          : `${dayItems.length} blocks`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ------------------------------------------------------------------
             3. Weekly Reflection BEFORE Statistics
             Exact Heading: "Take a Deeper Dive into Organizing and Reviewing Your Week"
             ------------------------------------------------------------------ */}
          <section className="week-reflection-card" aria-label="Weekly insights and review">
            <div className="week-reflection-header">
              <div className="week-reflection-icon-box">
                <BookOpen size={20} strokeWidth={2.2} />
              </div>
              <h2 className="week-reflection-title">
                Take a Deeper Dive into Organizing and Reviewing Your Week
              </h2>
            </div>

            {data.noticeParagraph ? (
              <p className="week-reflection-p">{data.noticeParagraph}</p>
            ) : (
              <p className="week-reflection-empty-state">
                Orbit is observing your schedule rhythm. As you complete and close days, personalized reflections about focus, recovery, and balance will appear here.
              </p>
            )}

            {data.suggestion && (
              <div className="week-suggestion-box">
                <span className="week-suggestion-badge">Suggestion</span>
                <p className="week-suggestion-text">{data.suggestion}</p>
              </div>
            )}
          </section>

          {/* ------------------------------------------------------------------
             4. Statistics & Habit Tracking (Placed below reflection)
             ------------------------------------------------------------------ */}
          <section className="week-stats-section" aria-label="Weekly energy and time balance">
            <div className="week-stats-grid">
              <div className="week-stat-card card-deep">
                <div className="week-stat-header">
                  <Clock size={18} strokeWidth={2.2} />
                  <span className="week-stat-title">Deep focus</span>
                </div>
                <div className="week-stat-value">
                  {deepFocusHours} hours
                  <span className="week-stat-sub"> / {deepFocusGoalHours}h goal</span>
                </div>
                <p className="week-stat-desc">
                  {Number(deepFocusHours) > 0
                    ? `${deepFocusHours} of ${deepFocusGoalHours} weekly focus hours completed.`
                    : `0 hours completed toward your ${deepFocusGoalHours}-hour weekly focus goal.`}
                </p>
              </div>

              <div className="week-stat-card card-rest">
                <div className="week-stat-header">
                  <Heart size={18} strokeWidth={2.2} />
                  <span className="week-stat-title">Rest & recovery</span>
                </div>
                <div className="week-stat-value">
                  {Number(data.restHours) > 0 ? `${data.restHours} hours` : '0.0 hours'}
                </div>
                <p className="week-stat-desc">
                  Protected meals, decompression cushions, and recovery windows.
                </p>
              </div>

              <div className="week-stat-card card-hobby">
                <div className="week-stat-header">
                  <Sparkles size={18} strokeWidth={2.2} />
                  <span className="week-stat-title">Protected hobby time</span>
                </div>
                <div className="week-stat-value">
                  {protectedHobbyHours}h
                  <span className="week-stat-sub"> / {protectedHobbyGoalHours.toFixed(1)}h goal</span>
                </div>
                <p className="week-stat-desc">
                  Scheduled hobby blocks explicitly protected by Orbit, excluding displaced blocks and ordinary focused tasks.
                </p>
              </div>
            </div>
          </section>

          {/* Habit & Study Focus Circles Matrix */}
          <section className="week-card" aria-label="Habit and study rhythm tracking">
            <div className="week-table-header">
              <span className="week-table-col-label">Habit & Study Rhythm</span>
              <div className="week-days-indicators-row">
                {days.map((day) => (
                  <div key={day.date} className="week-day-indicator-col">
                    <span className="indicator-day-name">{day.weekday}</span>
                    <span className="indicator-day-date">{day.date.split('-')[2]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Groups List */}
            {groups.length === 0 ? (
              <div className="week-groups-empty">
                <p>No habits or recurring study tracks recorded yet this week.</p>
              </div>
            ) : (
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
                              ? 'Day open / in-progress'
                              : 'No session planned'
                          }
                          aria-label={`${days[idx]?.weekday}: ${state}`}
                        >
                          {state === 'done' && <CheckCircle2 size={13} strokeWidth={2.5} />}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Circle Legend */}
            <div className="week-legend">
              <div className="week-legend-item">
                <div className="week-circle week-circle-done" style={{ width: 16, height: 16 }} />
                <span>Completed on closed day</span>
              </div>
              <div className="week-legend-item">
                <div className="week-circle week-circle-moved" style={{ width: 16, height: 16 }} />
                <span>Moved to another day</span>
              </div>
              <div className="week-legend-item">
                <div className="week-circle week-circle-unclosed" style={{ width: 16, height: 16 }} />
                <span>Day open / in-progress</span>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------------------
             5. Dismissible Modal for Selected Day's Complete Schedule
             ------------------------------------------------------------------ */}
          {isModalOpen && activeDay && (
            <div
              className="modal-backdrop week-modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="week-schedule-modal-title"
              onClick={handleCloseModal}
            >
              <div
                className="modal-dialog week-schedule-modal-dialog"
                ref={modalRef}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="week-modal-header">
                  <div className="week-modal-header-titles">
                    <div className="week-selected-accent-tag">Day schedule</div>
                    <h2 id="week-schedule-modal-title" className="week-modal-title">
                      {activeDay.fullWeekday},{' '}
                      {new Date(activeDay.date + 'T00:00:00').toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                      })}
                    </h2>
                    <div className="week-selected-meta">
                      <span className="week-summary-chip">{formatDuration(activeTotalStudyMins)} study focus</span>
                      <span className="week-summary-chip">{activeCompletedTasks} completed</span>
                      <span className="week-summary-chip">{activeRemainingTasks} remaining</span>
                      {activeDay.is_closed && (
                        <span className="week-summary-chip chip-closed-badge">Day closed</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    ref={closeButtonRef}
                    className="pop-btn pop-btn-modal-close"
                    onClick={handleCloseModal}
                    aria-label="Close schedule modal"
                    title="Close (Escape)"
                  >
                    <X size={18} strokeWidth={2.5} />
                  </button>
                </div>

                {/* Modal Scrollable Body */}
                <div className="week-modal-body">
                  {activeDayItems.length === 0 ? (
                    <div className="week-day-empty">
                      <BookOpen size={30} strokeWidth={2.2} />
                      <p>No activities scheduled for this day.</p>
                    </div>
                  ) : (
                    <div className="week-schedule-timeline">
                      {activeDayItems.map((item, idx) => {
                        const dur = calcMinutes(item.start_time, item.end_time);
                        const isDisplaced = !!item.displacement_reason;
                        const isDone = !!item.done;
                        const major = isMajorActivity(item);

                        return (
                          <div
                            key={item.id || idx}
                            className={`week-schedule-item ${major ? 'is-major-block' : 'is-minor-block'} ${
                              isDone ? 'is-done-item' : ''
                            }`}
                          >
                            <div className="week-schedule-item-time">
                              <span className="time-start">{formatTime(item.start_time)}</span>
                              <span className="time-end">{formatTime(item.end_time)}</span>
                            </div>

                            {/* Interactive Checkbox for non-fixed blocks */}
                            {!item.is_fixed ? (
                              <button
                                type="button"
                                className={`pop-check-btn ${isDone ? 'checked' : ''}`}
                                onClick={() => handleToggleDone(item)}
                                disabled={activeDay.is_closed}
                                aria-label={`Mark ${item.title} as ${isDone ? 'provisional' : 'completed'}`}
                              >
                                {isDone && <Check size={16} strokeWidth={3} />}
                              </button>
                            ) : (
                              <div className="week-fixed-icon-box">
                                {getKindIcon(item.kind)}
                              </div>
                            )}

                            <div className="week-schedule-item-info">
                              <div className="week-schedule-item-title-row">
                                <span className={`week-schedule-item-title ${isDone ? 'done-text' : ''}`}>
                                  {item.title}
                                </span>
                                <span className="week-schedule-item-duration">{formatDuration(dur)}</span>
                              </div>

                              {isDisplaced && (
                                <div className="week-schedule-displaced-note">
                                  <CornerDownRight size={13} strokeWidth={2.5} />
                                  <span>{item.displacement_reason}</span>
                                </div>
                              )}

                              {item.suggestion && !isDisplaced && (
                                <div className="week-schedule-suggestion-note">
                                  {item.suggestion}
                                </div>
                              )}
                            </div>

                            <div className="week-schedule-item-badge">
                              {renderKindBadge(item.kind, isDisplaced, item.tier)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="week-modal-footer">
                  <span className="week-modal-esc-hint">Press Escape or click outside to dismiss</span>
                  <button
                    type="button"
                    className="pop-btn pop-btn-yellow"
                    onClick={handleCloseModal}
                  >
                    Done viewing
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Week;