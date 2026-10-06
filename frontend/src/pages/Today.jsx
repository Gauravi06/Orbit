import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  AlertCircle,
  Check,
  X,
  Loader2,
  CheckCircle2,
  HelpCircle,
  CalendarCheck,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import {
  getSchedule,
  generateSchedule,
  sendNote,
  saveNote,
  setItemDone,
  closeDay,
  reopenDay,
  checkUnclosedPastDay,
  replanSchedule,
  checkNoteVague,
  errText,
} from '../api/client';
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

  // Unclosed past day banner
  const [unclosedNotice, setUnclosedNotice] = useState(null);

  // "Done for the day" state & summary card
  const [closingDay, setClosingDay] = useState(false);
  const [closeSummary, setCloseSummary] = useState(null);

  // "This works" thanks banner
  const [worksMessage, setWorksMessage] = useState('');

  // "Not quite right" modal state
  const [offModalOpen, setOffModalOpen] = useState(false);
  const [offReason, setOffReason] = useState('Too much on my plate');
  const [offDetail, setOffDetail] = useState('');
  const [offSubmitting, setOffSubmitting] = useState(false);
  const offModalRef = useRef(null);

  // "Tell Orbit anything" note box state
  const [noteText, setNoteText] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [confirmCard, setConfirmCard] = useState(null); // { kind, understood, message, rawText }

  // Clarifying modal for vague notes
  const [vagueModalOpen, setVagueModalOpen] = useState(false);
  const [clarifyQ1, setClarifyQ1] = useState('');
  const [clarifyQ2, setClarifyQ2] = useState('');
  const [pendingNoteData, setPendingNoteData] = useState(null);
  const vagueModalRef = useRef(null);

  // Re-plan result display (Here is what changed / Keep or Undo)
  const [replanResult, setReplanResult] = useState(null);

  // Load schedule for selected date asynchronously
  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSchedule(selectedDate);
      setSchedule(data);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getSchedule(selectedDate);
        if (active) setSchedule(data);

        // Check if yesterday was never closed
        const unclosed = await checkUnclosedPastDay();
        if (active && unclosed && selectedDate === ymd(new Date())) {
          setUnclosedNotice(unclosed);
        } else if (active) {
          setUnclosedNotice(null);
        }
      } catch (err) {
        if (active) setError(errText(err));
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [selectedDate]);

  // Keyboard accessibility & focus traps for modals
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (offModalOpen) setOffModalOpen(false);
        if (vagueModalOpen) setVagueModalOpen(false);
      }
    };
    if (offModalOpen || vagueModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [offModalOpen, vagueModalOpen]);

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

  /* 1. Ticking non-fixed blocks */
  const handleToggleDone = async (item) => {
    if (item.is_fixed || schedule?.is_closed) return;
    const nextDone = !item.done;

    // Optimistic state update
    setSchedule((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((i) => (i.id === item.id ? { ...i, done: nextDone } : i)),
      };
    });

    try {
      await setItemDone(item.id, nextDone);
    } catch (err) {
      setError(errText(err));
      await fetchSchedule();
    }
  };

  /* 2. "Done for the day" */
  const handleDoneForDay = async () => {
    setClosingDay(true);
    setError('');
    try {
      const res = await closeDay(selectedDate);
      setCloseSummary(res);
      await fetchSchedule();
    } catch (err) {
      setError(errText(err));
    } finally {
      setClosingDay(false);
    }
  };

  const handleReopen = async () => {
    setClosingDay(true);
    try {
      await reopenDay(selectedDate);
      setCloseSummary(null);
      await fetchSchedule();
    } catch (err) {
      setError(errText(err));
    } finally {
      setClosingDay(false);
    }
  };

  /* 4. Feedback: "This works" */
  const handleThisWorks = async () => {
    setWorksMessage('Thank you. Orbit will protect this steady rhythm for you.');
    setTimeout(() => setWorksMessage(''), 4500);
  };

  /* 4. Feedback: "Not quite right" Submit */
  const handleOffSubmit = async (e) => {
    e.preventDefault();
    setOffSubmitting(true);
    try {
      const res = await replanSchedule({
        reason: offReason,
        feedbackText: offDetail,
      });
      setOffModalOpen(false);
      setOffDetail('');
      setReplanResult(res);
      await fetchSchedule();
    } catch (err) {
      setError(errText(err));
    } finally {
      setOffSubmitting(false);
    }
  };

  /* 5. "Tell Orbit anything" */
  const handleNoteSubmit = async (e) => {
    e.preventDefault();
    if (!noteText.trim()) return;

    setNoteLoading(true);
    setError('');
    try {
      const understoodData = await sendNote(noteText.trim());
      setConfirmCard({
        kind: understoodData.kind,
        understood: understoodData.understood,
        message: understoodData.message,
        rawText: noteText.trim(),
      });
    } catch (err) {
      setError(errText(err));
    } finally {
      setNoteLoading(false);
    }
  };

  const handleConfirmSave = async () => {
    if (!confirmCard) return;

    // Check if the note is vague
    const isVague = checkNoteVague(confirmCard.rawText);
    if (isVague) {
      setPendingNoteData(confirmCard);
      setVagueModalOpen(true);
      return;
    }

    // Execute save and re-plan
    await executeSaveAndReplan(confirmCard);
  };

  const executeSaveAndReplan = async (cardData, clarification = '') => {
    setNoteLoading(true);
    setError('');
    try {
      await saveNote({
        text: cardData.rawText,
        kind: cardData.kind,
      });

      const res = await replanSchedule({
        feedbackText: cardData.rawText,
        clarification,
      });

      setConfirmCard(null);
      setNoteText('');
      setReplanResult(res);
      await fetchSchedule();
    } catch (err) {
      setError(errText(err));
    } finally {
      setNoteLoading(false);
    }
  };

  const handleSkipClarification = async () => {
    if (!pendingNoteData) return;
    setVagueModalOpen(false);
    // User skipped clarification: save note only, do not re-plan
    setNoteLoading(true);
    try {
      await saveNote({
        text: pendingNoteData.rawText,
        kind: pendingNoteData.kind,
      });
      setConfirmCard(null);
      setNoteText('');
      setWorksMessage('Note recorded quietly without schedule changes.');
      setTimeout(() => setWorksMessage(''), 4000);
    } catch (err) {
      setError(errText(err));
    } finally {
      setNoteLoading(false);
      setPendingNoteData(null);
    }
  };

  const handleSubmitClarification = async (e) => {
    e.preventDefault();
    if (!pendingNoteData) return;
    setVagueModalOpen(false);
    const combinedClarification = `${clarifyQ1} ${clarifyQ2}`.trim();
    await executeSaveAndReplan(pendingNoteData, combinedClarification);
    setPendingNoteData(null);
    setClarifyQ1('');
    setClarifyQ2('');
  };

  // Day tabs: Complete current Monday-Sunday week (7 days)
  const dayTabs = useMemo(() => {
    const list = [];
    const now = new Date();
    const todayStr = ymd(now);
    const currentDayOfWeek = now.getDay(); // 0 Sun, 1 Mon ... 6 Sat
    const monDiff = (currentDayOfWeek === 0 ? -6 : 1) - currentDayOfWeek;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + monDiff);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const str = ymd(d);
      const isCurrentDay = str === todayStr;
      const shortWeekday = d.toLocaleDateString('en-US', { weekday: 'short' });
      const weekday = isCurrentDay ? 'Today' : shortWeekday;
      const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      list.push({ dateStr: str, weekday, dateLabel, isToday: isCurrentDay });
    }
    return list;
  }, []);

  const items = schedule?.items || [];
  const deepWorkMins = items
    .filter((i) => i.kind === 'deep' && i.status !== 'displaced')
    .reduce((acc, i) => acc + calcMinutes(i.start_time, i.end_time), 0);
  const totalStudyMins = items
    .filter((i) => (i.kind === 'deep' || i.kind === 'short') && i.status !== 'displaced')
    .reduce((acc, i) => acc + calcMinutes(i.start_time, i.end_time), 0);
  const displacedCount = items.filter((i) => i.displacement_reason).length;

  const renderKindBadge = (kind, displaced, tier) => {
    if (displaced) {
      return <span className="tag">Rescheduled</span>;
    }
    switch (kind) {
      case 'fixed':
        return <span className="tag">Fixed</span>;
      case 'deep':
        return <span className="tag tag-accent">Deep Work</span>;
      case 'short':
        return <span className="tag">{tier === 'like_to' ? 'Protected Hobby' : 'Focused'}</span>;
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

  const isToday = selectedDate === ymd(new Date());

  return (
    <div className="today-page">
      {/* Unclosed past day banner */}
      {unclosedNotice && (
        <div className="today-unclosed-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <CalendarCheck size={16} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
            <span>Close out yesterday ({unclosedNotice.weekday})? Unticked work will find a fresh slot.</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-3)' }}
            onClick={() => setSelectedDate(unclosedNotice.unclosedDate)}
          >
            Review yesterday
          </button>
        </div>
      )}

      {/* Header */}
      <div className="today-header">
        <div className="today-header-left">
          <span className="today-date-badge">
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
            {schedule?.is_closed && ' · CLOSED'}
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
            disabled={generating || loading || schedule?.is_closed}
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
            const isDone = !!item.done;

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
                  } ${isDone ? 'timeline-card-done' : ''}`}
                >
                  <div className="timeline-card-header">
                    <div className="timeline-title-row">
                      {/* Checkbox for non-fixed blocks */}
                      {!item.is_fixed ? (
                        <button
                          type="button"
                          className={`block-checkbox ${isDone ? 'checked' : ''}`}
                          onClick={() => handleToggleDone(item)}
                          disabled={schedule?.is_closed}
                          aria-label={`Mark ${item.title} as ${isDone ? 'provisional' : 'completed'}`}
                        >
                          {isDone && <Check size={13} strokeWidth={2} />}
                        </button>
                      ) : (
                        getKindIcon(item.kind)
                      )}

                      <h3 className={`timeline-title ${isDone ? 'done-text' : ''}`}>
                        {item.title}
                      </h3>
                      {renderKindBadge(item.kind, isDisplaced, item.tier)}
                    </div>
                    <span className="timeline-meta">{formatDuration(duration)}</span>
                  </div>

                  {/* Calm displacement note */}
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

      {/* Done for the Day Action / Summary */}
      {!loading && items.length > 0 && (
        <div className="today-close-section">
          {!schedule?.is_closed ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>
                  Finished working for the day?
                </span>
                <p className="text-muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
                  Ticks lock in and unticked work quietly finds a free slot over the coming days.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDoneForDay}
                disabled={closingDay}
              >
                {closingDay ? (
                  <>
                    <Loader2 size={14} className="spin" strokeWidth={1.5} />
                    <span>Closing day…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} strokeWidth={1.5} />
                    <span>Done for the day</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <span className="tag tag-accent">Day Closed</span>
                <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
                  Recorded on your weekly planner spread. Reopening is allowed until tomorrow morning.
                </p>
              </div>
              {isToday && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleReopen}
                  disabled={closingDay}
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  <RotateCcw size={13} strokeWidth={1.5} />
                  <span>Reopen this day</span>
                </button>
              )}
            </div>
          )}

          {/* Close day summary card (Reuse Something changed UI) */}
          {closeSummary && (
            <div className="changed-result-card" style={{ marginTop: 'var(--space-4)' }}>
              <div className="changed-result-header">
                <div>
                  <h3 style={{ fontFamily: 'var(--font-display)', margin: 0, fontSize: 'var(--text-md)' }}>
                    {closeSummary.summary}
                  </h3>
                  <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                    Nothing failed · Work shifted quietly
                  </span>
                </div>
              </div>

              {/* What changed list */}
              <div className="changed-list">
                {closeSummary.what_changed.map((line, idx) => (
                  <div key={idx} className="changed-list-item">
                    <CheckCircle2 size={15} className="changed-list-icon" strokeWidth={1.5} />
                    <span>{line}</span>
                  </div>
                ))}
              </div>

              {/* Edge Cases: No slot before deadline or moved twice */}
              {closeSummary.edgeCases?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {closeSummary.edgeCases.map((ec, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: 'var(--surface-2)',
                        border: '1px solid var(--line)',
                        padding: 'var(--space-3)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-xs)',
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 'var(--space-2)',
                      }}
                    >
                      <HelpCircle size={14} strokeWidth={1.5} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <div>
                        <strong>{ec.itemTitle}</strong>: {ec.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="changed-actions-bar">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCloseSummary(null)}
                >
                  <RotateCcw size={13} strokeWidth={1.5} />
                  <span>Undo</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCloseSummary(null)}
                >
                  <span>Keep this plan</span>
                  <ChevronRight size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Two buttons "This works" and "Not quite right" */}
      <div className="today-feedback-two-buttons">
        <span className="today-feedback-label">HOW DID TODAY'S RHYTHM FEEL?</span>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleThisWorks}
          >
            <Check size={14} strokeWidth={1.5} />
            <span>This works</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setOffModalOpen(true)}
          >
            <Sparkles size={14} strokeWidth={1.5} />
            <span>Not quite right</span>
          </button>
        </div>
      </div>

      {worksMessage && (
        <div className="today-note-feedback" role="status">
          <span>{worksMessage}</span>
        </div>
      )}

      {/* "Tell Orbit anything" Note Box */}
      <div className="today-note-card">
        <h2 className="today-note-title">Tell Orbit anything</h2>

        <form onSubmit={handleNoteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <textarea
            className="input today-note-textarea"
            rows={3}
            placeholder="What worked today, what didn't, or anything Orbit should know about how you work."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            disabled={noteLoading || !!confirmCard}
          />

          {!confirmCard && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={noteLoading || !noteText.trim()}
              >
                {noteLoading ? (
                  <>
                    <Loader2 size={14} className="spin" strokeWidth={1.5} />
                    <span>Listening…</span>
                  </>
                ) : (
                  <span>Send to Orbit</span>
                )}
              </button>
            </div>
          )}
        </form>

        {/* Confirm Card: Nothing is saved until the user taps Save */}
        {confirmCard && (
          <div className="today-confirm-card" role="region" aria-label="Confirm Note">
            <div className="today-confirm-header">
              <span className="tag tag-accent" style={{ textTransform: 'capitalize' }}>
                {confirmCard.kind}
              </span>
              <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                Please confirm
              </span>
            </div>
            <p className="today-confirm-sentence">{confirmCard.understood}</p>
            <div className="today-confirm-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmCard(null)}
                disabled={noteLoading}
              >
                <X size={14} strokeWidth={1.5} />
                <span>Not quite</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmSave}
                disabled={noteLoading}
              >
                {noteLoading ? (
                  <>
                    <Loader2 size={14} className="spin" strokeWidth={1.5} />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Check size={14} strokeWidth={1.5} />
                    <span>Save</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 5: Re-plan Result (Here is what changed / Keep or Undo) */}
      {replanResult && (
        <div className="changed-result-card">
          <div className="changed-result-header">
            <div>
              <span className="tag tag-accent">Adapting Tomorrow Onward</span>
              <h3 style={{ fontFamily: 'var(--font-display)', margin: 0, fontSize: 'var(--text-md)', marginTop: '4px' }}>
                Here is what changed
              </h3>
            </div>
            <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
              Past days & today's ticks preserved
            </span>
          </div>

          <div className="changed-list">
            {replanResult.what_changed.map((change, idx) => (
              <div key={idx} className="changed-list-item">
                <CheckCircle2 size={15} className="changed-list-icon" strokeWidth={1.5} />
                <span>{change}</span>
              </div>
            ))}
          </div>

          <div className="changed-actions-bar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setReplanResult(null)}
            >
              <RotateCcw size={13} strokeWidth={1.5} />
              <span>Undo</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setReplanResult(null)}
            >
              <span>Keep this plan</span>
              <ChevronRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}

      {/* Modal 1: "What felt off?" (Focus trap, Esc closes, skippable) */}
      {offModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="off-modal-title">
          <div className="modal-dialog" ref={offModalRef}>
            <div className="modal-header">
              <h2 id="off-modal-title" className="modal-title">What felt off?</h2>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px' }}
                onClick={() => setOffModalOpen(false)}
                aria-label="Close dialog"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <form onSubmit={handleOffSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="modal-options-list">
                {[
                  'Too much on my plate',
                  'Wrong time of day',
                  'Breaks too short',
                  'Something else',
                ].map((opt) => (
                  <label key={opt} className="modal-radio-label">
                    <input
                      type="radio"
                      name="off-reason"
                      checked={offReason === opt}
                      onChange={() => setOffReason(opt)}
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>

              {offReason === 'Something else' && (
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Tell Orbit what wasn't working…"
                  value={offDetail}
                  onChange={(e) => setOffDetail(e.target.value)}
                  autoFocus
                />
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setOffModalOpen(false)}
                  disabled={offSubmitting}
                >
                  Skip
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={offSubmitting}
                >
                  {offSubmitting ? 'Adapting…' : 'Re-plan Tomorrow'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Vague Note Clarification (At most 2 questions, skippable) */}
      {vagueModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="vague-modal-title">
          <div className="modal-dialog" ref={vagueModalRef}>
            <div className="modal-header">
              <h2 id="vague-modal-title" className="modal-title">Help Orbit understand</h2>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px' }}
                onClick={handleSkipClarification}
                aria-label="Close and save note only"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
              Orbit wants to make sure upcoming plans reflect what you need:
            </p>

            <form onSubmit={handleSubmitClarification} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label style={{ fontSize: 'var(--text-xs)' }}>1. Should we adjust your study load or your break timing?</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Lighten the study load, or longer pauses"
                  value={clarifyQ1}
                  onChange={(e) => setClarifyQ1(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: 'var(--text-xs)' }}>2. Any specific time of day you'd like us to keep clear?</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Keep tomorrow evening free"
                  value={clarifyQ2}
                  onChange={(e) => setClarifyQ2(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleSkipClarification}
                >
                  Skip & Save Note Only
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Re-plan with details
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Today;
