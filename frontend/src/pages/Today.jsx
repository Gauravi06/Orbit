import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ThumbsUp,
  Trash2,
  ArrowRight,
  Clock,
  Compass,
} from 'lucide-react';
import {
  getSchedule,
  proposeSchedule,
  proposeDisruption,
  approveProposal,
  rejectProposal,
  sendNote,
  saveNote,
  setItemDone,
  closeDay,
  reopenDay,
  replanSchedule,
  checkNoteVague,
  errText,
  getInterventions,
  dismissIntervention,
  snoozeIntervention,
} from '../api/client';
import { findCurrentOrNextBlockIndex, getBlockTimeStatus } from './todayTimeSelection';
import './Today.css';

import { formatTime12 } from '../utils/timeFormat';

/* Helper functions for dates & times */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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

function computeSnoozeIso(hours = 3) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

export function Today() {
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [selectedDate] = useState(() => ymd(new Date()));

  // Active front-card index in the stack
  const [activeCardIndex, setActiveCardIndex] = useState(0);

  // User manually browsed the stack flag
  const userInteractedStackRef = useRef(false);

  // Collapsible full schedule section
  const [fullScheduleOpen, setFullScheduleOpen] = useState(false);

  // Quick disruption prompt input in "Something changed?" panel
  const [disruptText, setDisruptText] = useState('');
  const [disruptLoading, setDisruptLoading] = useState(false);

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
  const [confirmCard, setConfirmCard] = useState(null);
  const [noteError, setNoteError] = useState('');

  // Clarifying modal for vague notes
  const [vagueModalOpen, setVagueModalOpen] = useState(false);
  const [clarifyQ1, setClarifyQ1] = useState('');
  const [clarifyQ2, setClarifyQ2] = useState('');
  const [pendingNoteData, setPendingNoteData] = useState(null);
  const vagueModalRef = useRef(null);

  // Re-plan result display (Here is what changed / Keep or Undo)
  const [replanResult, setReplanResult] = useState(null);

  // Proposal state
  const [proposal, setProposal] = useState(null);
  const [approving, setApproving] = useState(false);

  // Proactive interventions state
  const [activeInterventions, setActiveInterventions] = useState([]);

  useEffect(() => {
    let ignore = false;
    const fetchInterventions = async () => {
      try {
        const list = await getInterventions('active');
        if (!ignore) {
          setActiveInterventions(Array.isArray(list) ? list : []);
        }
      } catch {
        // ignore
      }
    };

    fetchInterventions();
    const handleUpdate = () => { fetchInterventions(); };
    window.addEventListener('orbit-interventions-updated', handleUpdate);
    return () => {
      ignore = true;
      window.removeEventListener('orbit-interventions-updated', handleUpdate);
    };
  }, []);

  const handleSnoozeIntervention = async (id, hours = 3) => {
    try {
      const snoozeUntil = computeSnoozeIso(hours);
      await snoozeIntervention(id, snoozeUntil);
      window.dispatchEvent(new Event('orbit-interventions-updated'));
    } catch (e) {
      console.error('Failed to snooze intervention', e);
    }
  };

  const handleDismissIntervention = async (id) => {
    try {
      await dismissIntervention(id);
      window.dispatchEvent(new Event('orbit-interventions-updated'));
    } catch (e) {
      console.error('Failed to dismiss intervention', e);
    }
  };
  const [discarding, setDiscarding] = useState(false);

  // Touch tracking for swipe gestures
  const touchStartY = useRef(null);

  // Load schedule for selected date
  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSchedule(selectedDate);
      setSchedule(data);
      userInteractedStackRef.current = false;
      const currentItems = data?.items || [];
      if (currentItems.length > 0 && selectedDate === ymd(new Date())) {
        setActiveCardIndex(findCurrentOrNextBlockIndex(currentItems, new Date()));
      } else {
        setActiveCardIndex(0);
      }
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
        if (active) {
          setSchedule(data);
          userInteractedStackRef.current = false;
          const currentItems = data?.items || [];
          if (currentItems.length > 0 && selectedDate === ymd(new Date())) {
            setActiveCardIndex(findCurrentOrNextBlockIndex(currentItems, new Date()));
          } else {
            setActiveCardIndex(0);
          }
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

  // Synchronize front-card selection based on local time
  const items = useMemo(() => schedule?.items || [], [schedule?.items]);
  const isSelectedDateToday = selectedDate === ymd(new Date());

  // Periodically update current time to trigger time-aware updates without refresh
  useEffect(() => {
    const timer = setInterval(() => {
      if (!userInteractedStackRef.current && isSelectedDateToday && items.length > 0) {
        setActiveCardIndex(findCurrentOrNextBlockIndex(items, new Date()));
      }
    }, 30000); // Check every 30s
    return () => clearInterval(timer);
  }, [items, isSelectedDateToday]);

  // Modals keyboard escape handler
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

  // Card navigation handlers (Swipe up / PageDown to advance; Swipe down / PageUp to revisit earlier)
  const handleNextCard = useCallback(() => {
    if (items.length <= 1) return;
    userInteractedStackRef.current = true;
    setActiveCardIndex((prev) => Math.min(items.length - 1, prev + 1));
  }, [items.length]);

  const handlePrevCard = useCallback(() => {
    if (items.length <= 1) return;
    userInteractedStackRef.current = true;
    setActiveCardIndex((prev) => Math.max(0, prev - 1));
  }, [items.length]);

  // Laptop keyboard navigation: PageDown / PageUp
  useEffect(() => {
    const handleStackKeyNav = (e) => {
      if (items.length <= 1) return;
      // If user is typing in a textarea or input, do not hijack PageUp / PageDown
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.key === 'PageDown') {
        e.preventDefault();
        handleNextCard();
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        handlePrevCard();
      }
    };

    window.addEventListener('keydown', handleStackKeyNav);
    return () => window.removeEventListener('keydown', handleStackKeyNav);
  }, [items.length, handleNextCard, handlePrevCard]);

  // Touch swipe handling
  const handleTouchStart = (e) => {
    if (e.touches && e.touches.length > 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = (e) => {
    if (touchStartY.current === null) return;
    const touchEndY = e.changedTouches[0].clientY;
    const diffY = touchStartY.current - touchEndY;
    const threshold = 40; // minimum swipe distance

    // Swipe up (finger moves up, diffY > 0) -> advance to next card
    if (diffY > threshold) {
      handleNextCard();
    }
    // Swipe down (finger moves down, diffY < 0) -> revisit earlier card
    else if (diffY < -threshold) {
      handlePrevCard();
    }
    touchStartY.current = null;
  };

  // Generate / Recalculate Day Proposal
  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const data = await proposeSchedule(selectedDate);
      setProposal(data);
    } catch (err) {
      setError(errText(err));
    } finally {
      setGenerating(false);
    }
  };

  // Submit quick disruption from "Something changed?" panel
  const handleDisruptSubmit = async (e) => {
    e?.preventDefault();
    const text = disruptText.trim();
    if (!text || disruptLoading) return;

    setDisruptLoading(true);
    setError('');
    try {
      const data = await proposeDisruption(text, selectedDate);
      setProposal(data);
      setDisruptText('');
    } catch (err) {
      setError(errText(err));
    } finally {
      setDisruptLoading(false);
    }
  };

  const handleApproveProposal = async () => {
    if (!proposal || approving || discarding) return;
    setApproving(true);
    setError('');
    try {
      await approveProposal(proposal.proposal_id);
      setProposal(null);
      await fetchSchedule();
    } catch (err) {
      setError(errText(err));
    } finally {
      setApproving(false);
    }
  };

  const handleRejectProposal = async () => {
    if (!proposal || approving || discarding) return;
    setDiscarding(true);
    setError('');
    try {
      await rejectProposal(proposal.proposal_id);
      setProposal(null);
    } catch (err) {
      setError(errText(err));
    } finally {
      setDiscarding(false);
    }
  };

  // Toggle item done status
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

  // Done for the day
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

  // Feedback: "This works"
  const handleThisWorks = async () => {
    setWorksMessage('Thank you. Orbit will protect this steady rhythm for you.');
    setTimeout(() => setWorksMessage(''), 4500);
  };

  // Feedback: "Not quite right"
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
      if (res.proposal) {
        setProposal(res.proposal);
        setReplanResult(null);
        setWorksMessage(res.message || 'Proposed schedule adjustment created. Review and approve below.');
        setTimeout(() => setWorksMessage(''), 5000);
      } else {
        setReplanResult(res);
        setWorksMessage(res.message || 'Feedback recorded. Active schedule unchanged.');
        setTimeout(() => setWorksMessage(''), 5000);
      }
      await fetchSchedule();
    } catch (err) {
      setError(errText(err));
    } finally {
      setOffSubmitting(false);
    }
  };

  // Note box submit
  const handleNoteSubmit = async (e) => {
    e.preventDefault();
    if (!noteText.trim()) return;

    setNoteLoading(true);
    setError('');
    setNoteError('');
    try {
      const understoodData = await sendNote(noteText.trim());
      setConfirmCard({
        kind: understoodData.kind,
        understood: understoodData.understood,
        message: understoodData.message,
        rawText: noteText.trim(),
      });
    } catch (err) {
      const msg = errText(err);
      setError(msg);
      setNoteError(msg);
    } finally {
      setNoteLoading(false);
    }
  };

  const handleConfirmSave = async () => {
    if (!confirmCard) return;

    const isVague = checkNoteVague(confirmCard.rawText);
    if (isVague) {
      setPendingNoteData(confirmCard);
      setVagueModalOpen(true);
      return;
    }

    await executeSaveAndReplan(confirmCard);
  };

  const executeSaveAndReplan = async (cardData, clarification = '') => {
    setNoteLoading(true);
    setError('');
    setNoteError('');
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
      if (res.proposal) {
        setProposal(res.proposal);
        setReplanResult(null);
        setWorksMessage(res.message || 'Proposed schedule adjustment created. Review and approve below.');
        setTimeout(() => setWorksMessage(''), 5000);
      } else {
        setReplanResult(res);
        setWorksMessage(res.message || 'Feedback recorded. Active schedule unchanged.');
        setTimeout(() => setWorksMessage(''), 5000);
      }
      await fetchSchedule();
    } catch (err) {
      const msg = errText(err);
      setError(msg);
      setNoteError(msg);
    } finally {
      setNoteLoading(false);
    }
  };

  const handleSkipClarification = async () => {
    if (!pendingNoteData) return;
    setVagueModalOpen(false);
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

  const isToday = selectedDate === ymd(new Date());

  // Current front card and rear card
  const frontCard = items[activeCardIndex] || null;
  const rearCard = items.length > 1 && activeCardIndex < items.length - 1 ? items[activeCardIndex + 1] : null;
  const frontCardDuration = frontCard ? calcMinutes(frontCard.start_time, frontCard.end_time) : 0;
  const frontCardIsDisplaced = !!frontCard?.displacement_reason;
  const frontCardIsDone = !!frontCard?.done;
  const frontCardTimeStatus = frontCard && isSelectedDateToday
    ? getBlockTimeStatus(frontCard, new Date())
    : 'scheduled';

  return (
    <div className="today-page">
      {/* Hand-drawn student-life doodles around the edges */}
      <div className="today-doodles-layer" aria-hidden="true">
        {/* Star doodle top-right */}
        <svg className="today-doodle today-doodle-star-tr" width="54" height="54" viewBox="0 0 54 54" fill="none">
          <path
            d="M27 3L32 18L48 20L36 31L40 47L27 38L14 47L18 31L6 20L22 18L27 3Z"
            fill="#FFE066"
            stroke="#111111"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="27" cy="25" r="2.5" fill="#111111" />
        </svg>

        {/* Sparkle doodle left */}
        <svg className="today-doodle today-doodle-sparkle-l" width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path
            d="M24 4V44M4 24H44M10 10L38 38M10 38L38 10"
            stroke="#FF90E8"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>

        {/* Swirl doodle right */}
        <svg className="today-doodle today-doodle-swirl-r" width="46" height="46" viewBox="0 0 46 46" fill="none">
          <path
            d="M6 23C6 13.6112 13.6112 6 23 6C32.3888 6 40 13.6112 40 23C40 32.3888 32.3888 40 23 40C16 40 12 34 12 28C12 22 18 18 24 18"
            stroke="#B8F34A"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </svg>

        {/* Coffee cup doodle bottom-left */}
        <svg className="today-doodle today-doodle-coffee-bl" width="46" height="46" viewBox="0 0 46 46" fill="none">
          <path d="M10 16H32V32C32 35 29 38 25 38H17C13 38 10 35 10 32V16Z" fill="#B79CFF" stroke="#111111" strokeWidth="2.5" />
          <path d="M32 20H37C39 20 40 21 40 23V25C40 27 39 28 37 28H32" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M16 10C16 12 18 13 18 15" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
          <path d="M22 8C22 11 24 12 24 15" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
          <path d="M27 10C27 12 29 13 29 15" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
        </svg>

        {/* Geometric pencil doodle bottom-right */}
        <svg className="today-doodle today-doodle-pencil-br" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <path d="M8 36L12 26L32 6L38 12L18 32L8 36Z" fill="#FFE066" stroke="#111111" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M26 12L32 18" stroke="#111111" strokeWidth="2.5" />
        </svg>
      </div>

      {/* 1. Compact Header with today's local date */}
      <div className="today-header">
        <div className="today-header-left">
          <span className="today-date-badge-pill">
            <Clock size={13} strokeWidth={2.5} />
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
            {schedule?.is_closed && ' · Closed'}
          </span>
          <h1 className="today-title">Today's Rhythm</h1>
                  </div>

        <div className="today-header-actions">
          <button
            type="button"
            className="pop-btn pop-btn-lime pop-btn-icon"
            onClick={handleGenerate}
            disabled={generating || loading || schedule?.is_closed}
            aria-label="Recalculate day"
            title="Recalculate day"
          >
            <RefreshCw size={16} strokeWidth={2.2} className={generating ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="pop-error-banner" role="alert">
          <AlertCircle size={18} strokeWidth={2.5} />
          <span>{error}</span>
        </div>
      )}

      {/* Proactive Intervention Banners */}
      {activeInterventions.length > 0 && (
        <div className="today-interventions-container">
          {activeInterventions.map((inv) => (
            <div
              key={inv.id}
              className={`today-intervention-banner ${inv.intervention_type === 'overdue' ? 'overdue' : (inv.intervention_type === 'repeated_unfinished' ? 'repeated-unfinished' : 'approaching')}`}
              role="status"
            >
              <div className="today-intervention-left">
                <AlertCircle size={20} strokeWidth={2.4} className="today-intervention-icon" />
                <div className="today-intervention-content">
                  <div className="today-intervention-title">{inv.title}</div>
                  <div className="today-intervention-msg">{inv.message}</div>
                </div>
              </div>
              <div className="today-intervention-actions">
                <button
                  type="button"
                  className="today-intervention-btn snooze-btn"
                  onClick={() => handleSnoozeIntervention(inv.id, 3)}
                  title="Snooze for 3 hours"
                >
                  <Clock size={13} strokeWidth={2} />
                  <span>Snooze 3h</span>
                </button>
                <button
                  type="button"
                  className="today-intervention-btn dismiss-btn"
                  onClick={() => handleDismissIntervention(inv.id)}
                  title="Dismiss notification"
                >
                  <X size={14} strokeWidth={2.5} />
                  <span>Dismiss</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div style={{ marginTop: 'var(--space-4)', width: '100%' }}>
          <div className="pop-skeleton-box" style={{ height: '320px', maxWidth: '580px', margin: '0 auto' }} />
        </div>
      )}

      {/* Empty State */}
      {!loading && items.length === 0 && (
        <div className="today-empty">
          <div
            style={{
              width: '64px',
              height: '64px',
              background: 'var(--pop-yellow)',
              border: 'var(--pop-border)',
              borderRadius: 'var(--pop-radius-pill)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--pop-shadow-sm)',
            }}
          >
            <BookOpen size={30} strokeWidth={2.2} />
          </div>
          <h2 className="today-empty-title">Nothing planned yet today</h2>
          <p className="today-empty-desc">
            Add your assignments and fixed commitments, or generate a fresh schedule from your preferences.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <button type="button" className="pop-btn pop-btn-lime" onClick={handleGenerate}>
              <RefreshCw size={15} strokeWidth={2.2} />
              <span>Generate today's plan</span>
            </button>
            <Link to="/tasks" className="pop-btn pop-btn-yellow">
              <Plus size={15} strokeWidth={2.2} />
              <span>Add a task</span>
            </Link>
          </div>
        </div>
      )}

      {/* 2. PROMINENT OVERLAPPING TASK-CARD STACK */}
      {!loading && items.length > 0 && (
        <div className="today-stack-section">
          {/* Stack Navigation & Counter Header */}
          <div className="today-stack-meta-bar">
            <span className="today-stack-counter">
              Block {activeCardIndex + 1} of {items.length}
            </span>

            <div className="today-stack-controls">
              <button
                type="button"
                className="today-stack-nav-btn"
                onClick={handlePrevCard}
                disabled={activeCardIndex === 0}
                aria-label="Previous block"
                title="Previous block (Page Up / Swipe Down)"
              >
                <ChevronLeft size={20} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                className="today-stack-nav-btn"
                onClick={handleNextCard}
                disabled={activeCardIndex >= items.length - 1}
                aria-label="Next block"
                title="Next block (Page Down / Swipe Up)"
              >
                <ChevronRight size={20} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Interactive Stack Stage */}
          <div
            className="today-stack-stage"
            tabIndex={0}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            aria-label="Today's task card stack. Swipe up or press Page Down to advance; swipe down or press Page Up to revisit."
          >
            {/* REAR CARD: Next scheduled block shifted slightly up and left, rotated 5-8deg counter-clockwise */}
            {rearCard && (
              <div
                className="pop-card-rear"
                onClick={handleNextCard}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNextCard();
                  }
                }}
                aria-label={`Next card: ${rearCard.title}. Click to advance.`}
              >
                <div className="pop-card-rear-peek">
                  <span className="pop-card-rear-badge">Up Next</span>
                  <h3 className="pop-card-rear-title">{rearCard.title}</h3>
                </div>
                <div className="pop-card-rear-time">
                  {formatTime(rearCard.start_time)} – {formatTime(rearCard.end_time)} (
                  {formatDuration(calcMinutes(rearCard.start_time, rearCard.end_time))})
                </div>
              </div>
            )}

            {/* FRONT CARD: Perfectly straight, thick black outline, hard offset shadow */}
            {frontCard && (
              <div
                className={`pop-card-front kind-${frontCard.kind} ${frontCardIsDone ? 'is-completed' : ''}`}
              >
                <div className="pop-card-top-row">
                  <div className="pop-card-badges">
                    {isSelectedDateToday && frontCardTimeStatus === 'in_progress' && (
                      <span className="pop-pill-badge pop-pill-in-progress">
                        ● In progress
                      </span>
                    )}
                    {isSelectedDateToday && frontCardTimeStatus === 'upcoming' && (
                      <span className="pop-pill-badge pop-pill-upcoming">
                        Upcoming
                      </span>
                    )}
                    {isSelectedDateToday && frontCardTimeStatus === 'completed_time' && !frontCardIsDone && (
                      <span className="pop-pill-badge pop-pill-completed">
                        Past scheduled time
                      </span>
                    )}
                    {renderKindBadge(frontCard.kind, frontCardIsDisplaced, frontCard.tier)}
                  </div>

                  <div className="pop-card-time-display">
                    <Clock size={13} strokeWidth={2.5} />
                    <span>
                      {formatTime(frontCard.start_time)} – {formatTime(frontCard.end_time)}
                    </span>
                  </div>
                </div>

                <div className="pop-card-main-content">
                  {/* Checkbox for non-fixed blocks */}
                  {!frontCard.is_fixed ? (
                    <button
                      type="button"
                      className={`pop-check-btn ${frontCardIsDone ? 'checked' : ''}`}
                      onClick={() => handleToggleDone(frontCard)}
                      disabled={schedule?.is_closed}
                      aria-label={`Mark ${frontCard.title} as ${frontCardIsDone ? 'provisional' : 'completed'}`}
                    >
                      {frontCardIsDone && <Check size={18} strokeWidth={3} />}
                    </button>
                  ) : (
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--pop-yellow)',
                        border: 'var(--pop-border)',
                        borderRadius: 'var(--pop-radius-sm)',
                        boxShadow: '2px 2px 0 var(--pop-black)',
                      }}
                    >
                      {getKindIcon(frontCard.kind)}
                    </div>
                  )}

                  <div className="pop-card-title-group">
                    <h2 className={`pop-card-title ${frontCardIsDone ? 'done-strike' : ''}`}>
                      {frontCard.title}
                    </h2>
                    <span className="pop-card-duration-tag">
                      {formatDuration(frontCardDuration)}
                      {frontCard.is_fixed ? ' · Protected Commitment' : ''}
                    </span>
                  </div>
                </div>

                {/* Contextual notes / suggestions */}
                {frontCardIsDisplaced && (
                  <div className="pop-card-callout pop-card-callout-displaced">
                    <CornerDownRight size={15} strokeWidth={2.5} />
                    <span>{frontCard.displacement_reason}</span>
                  </div>
                )}

                {frontCard.suggestion && !frontCardIsDisplaced && (
                  <div className="pop-card-callout pop-card-callout-suggestion">
                    {frontCard.suggestion}
                  </div>
                )}

                {/* Footer swipe controls helper */}
                <div className="pop-card-footer-controls">
                  <span className="pop-card-swipe-hint">
                    Swipe up or Page Down to browse
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {activeCardIndex > 0 && (
                      <button
                        type="button"
                        className="pop-btn pop-btn-yellow"
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={handlePrevCard}
                      >
                        Previous
                      </button>
                    )}
                    {activeCardIndex < items.length - 1 && (
                      <button
                        type="button"
                        className="pop-btn pop-btn-lime"
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={handleNextCard}
                      >
                        Next block
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. COLLAPSIBLE "Your full schedule" SECTION */}
      {!loading && items.length > 0 && (
        <div className="today-full-schedule-accordion">
          <button
            type="button"
            className="today-accordion-trigger"
            onClick={() => setFullScheduleOpen((prev) => !prev)}
            aria-expanded={fullScheduleOpen}
          >
            <div className="today-accordion-title-group">
              <div className="today-accordion-icon-box">
                <Compass size={18} strokeWidth={2.5} />
              </div>
              <h3 className="today-accordion-heading">Your full schedule</h3>
              <span className="today-accordion-count-badge">
                {items.length} blocks
              </span>
            </div>

            <div className={`today-accordion-chevron ${fullScheduleOpen ? 'is-open' : ''}`}>
              <ChevronDown size={18} strokeWidth={2.5} />
            </div>
          </button>

          {fullScheduleOpen && (
            <div className="today-accordion-content">
              {items.map((item, idx) => {
                const isDisplaced = !!item.displacement_reason;
                const isDone = !!item.done;
                const isActive = idx === activeCardIndex;

                return (
                  <div
                    key={item.id || idx}
                    className={`full-schedule-list-item ${isActive ? 'is-active-item' : ''}`}
                  >
                    <div className="full-schedule-time">
                      {formatTime(item.start_time)} – {formatTime(item.end_time)}
                    </div>

                    {!item.is_fixed ? (
                      <button
                        type="button"
                        className={`pop-check-btn ${isDone ? 'checked' : ''}`}
                        style={{ width: '28px', height: '28px', boxShadow: '2px 2px 0 var(--pop-black)' }}
                        onClick={() => handleToggleDone(item)}
                        disabled={schedule?.is_closed}
                        aria-label={`Mark ${item.title} as ${isDone ? 'provisional' : 'completed'}`}
                      >
                        {isDone && <Check size={14} strokeWidth={3} />}
                      </button>
                    ) : (
                      <div style={{ width: '28px', display: 'flex', justifyContent: 'center' }}>
                        {getKindIcon(item.kind)}
                      </div>
                    )}

                    <div className={`full-schedule-title ${isDone ? 'done-text' : ''}`}>
                      {item.title}
                    </div>

                    <div className="full-schedule-item-actions">
                      {renderKindBadge(item.kind, isDisplaced, item.tier)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. LARGE ILLUSTRATED “Something changed?” PANEL (Near the Bottom) */}
      <div className="today-something-changed-panel">
        <div className="today-something-changed-content">
          <div className="today-something-changed-left">
            <div className="today-changed-illustration-box">
              {/* Playful geometric illustration with clock & stars */}
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="14" fill="#FFE066" stroke="#111111" strokeWidth="2.5" />
                <path d="M20 12V20L25 25" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M8 8L12 12" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M32 8L28 12" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h2 className="today-something-changed-title">Something changed?</h2>
              <p className="today-something-changed-desc">
                Lecture cancelled, unexpected quiz, or need rest? Tell Orbit in plain words. Your plan adapts calmly without guilt.
              </p>
            </div>
          </div>

          <Link
            to="/changed"
            className="pop-btn pop-btn-yellow"
            style={{ padding: '10px 18px', fontSize: '14px', flexShrink: 0 }}
          >
            <Sparkles size={16} strokeWidth={2.2} />
            <span>Open full disruption assistant</span>
            <ArrowRight size={15} strokeWidth={2.2} />
          </Link>
        </div>

        {/* Quick disruption submission input directly on Today page */}
        <form onSubmit={handleDisruptSubmit} className="today-changed-form">
          <div className="today-changed-input-row">
            <input
              type="text"
              className="today-changed-quick-input"
              placeholder="e.g. My 3 PM lecture got cancelled, or I have a headache and need a 1-hour rest…"
              value={disruptText}
              onChange={(e) => setDisruptText(e.target.value)}
              disabled={disruptLoading}
            />
            <button
              type="submit"
              className="pop-btn pop-btn-lime"
              disabled={disruptLoading || !disruptText.trim()}
              style={{ padding: '12px 20px', fontSize: '14px' }}
            >
              {disruptLoading ? (
                <>
                  <Loader2 size={16} className="spin" strokeWidth={2.5} />
                  <span>Adapting…</span>
                </>
              ) : (
                <>
                  <span>Adapt plan</span>
                  <ArrowRight size={16} strokeWidth={2.5} />
                </>
              )}
            </button>
          </div>

          <div className="today-changed-chips">
            <span className="today-changed-chip-label">Try quick ideas:</span>
            <button
              type="button"
              className="today-prompt-chip"
              onClick={() => setDisruptText('My 3 PM lecture got cancelled today')}
            >
              Lecture cancelled
            </button>
            <button
              type="button"
              className="today-prompt-chip"
              onClick={() => setDisruptText('I need a 45 minute break right now')}
            >
              Need a break
            </button>
            <button
              type="button"
              className="today-prompt-chip"
              onClick={() => setDisruptText('Unexpected assignment due tomorrow night')}
            >
              Sudden assignment
            </button>
          </div>
        </form>
      </div>

      {/* Pending Proposal Review */}
      {proposal && (
        <div className="changed-result-card">
          <div className="changed-result-header">
            <div>
              <span className="pop-pill-badge" style={{ background: 'var(--pop-yellow)', marginBottom: '6px' }}>
                Proposed plan
              </span>
              <h2 style={{ fontFamily: 'var(--pop-font-heading)', margin: 0, fontSize: '1.25rem' }}>
                {proposal.summary || 'Review proposed schedule changes'}
              </h2>
            </div>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--pop-muted)' }}>
              Active schedule unchanged until approved
            </span>
          </div>

          <div style={{ fontSize: '13px', color: 'var(--pop-dark)', marginBottom: '8px' }}>
            Orbit will not change your active schedule until you explicitly approve this proposal.
          </div>

          {/* Concise summary of what will change */}
          {proposal.what_changed && proposal.what_changed.length > 0 && (
            <div className="changed-list" style={{ marginBottom: '12px' }}>
              {proposal.what_changed.map((change, idx) => (
                <div key={idx} className="changed-list-item">
                  <CheckCircle2 size={18} className="changed-list-icon" strokeWidth={2.2} />
                  <span>{change}</span>
                </div>
              ))}
            </div>
          )}

          {/* Validation violations */}
          {proposal.violations && proposal.violations.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {proposal.violations.map((v, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#FFF1F0',
                    border: '1px solid #FFA39E',
                    padding: '10px 14px',
                    borderRadius: 'var(--pop-radius-sm)',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#CF1322',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <AlertCircle size={16} strokeWidth={2.2} />
                  <span>Violation: {v}</span>
                </div>
              ))}
            </div>
          )}

          {/* At-risk tasks */}
          {proposal.at_risk && proposal.at_risk.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {proposal.at_risk.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#FFF2F0',
                    border: 'var(--pop-border-thin)',
                    padding: '10px 14px',
                    borderRadius: 'var(--pop-radius-sm)',
                    fontSize: '13px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <AlertCircle size={16} strokeWidth={2.2} style={{ color: '#D9381E' }} />
                  <span>
                    <strong>{item.title}</strong>: {item.minutes_short ? `${item.minutes_short} mins short of deadline` : (item.reason || 'At risk of missing deadline')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Proposed days and actual placements with times */}
          {proposal.days && proposal.days.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '10px 0 16px 0' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--pop-dark)' }}>
                Proposed Day &amp; Time Placements:
              </div>
              {proposal.days
                .filter((d) => (d.items && d.items.length > 0) || (d.fixed && d.fixed.length > 0))
                .slice(0, 5)
                .map((day, dIdx) => (
                  <div
                    key={dIdx}
                    style={{
                      background: '#FAFAFA',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--pop-dark)', marginBottom: '6px' }}>
                      {day.date}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {(day.fixed || []).map((f, fIdx) => (
                        <div key={`f-${fIdx}`} style={{ fontSize: '12px', color: '#666', display: 'flex', justifyContent: 'space-between' }}>
                          <span>🔒 {f.title}</span>
                          <span>{formatTime(f.start)} – {formatTime(f.end)}</span>
                        </div>
                      ))}
                      {(day.items || []).map((it, iIdx) => (
                        <div key={`it-${iIdx}`} style={{ fontSize: '12px', color: '#111', display: 'flex', justifyContent: 'space-between' }}>
                          <span>
                            <strong>{it.title || 'Task Session'}</strong>
                            {it.displacement_reason && (
                              <span style={{ color: '#777', marginLeft: '6px' }}>({it.displacement_reason})</span>
                            )}
                          </span>
                          <span style={{ fontWeight: 600 }}>{formatTime(it.start_time)} – {formatTime(it.end_time)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div style={{ padding: '12px', color: '#666', fontSize: '13px', background: '#F9FAFB', borderRadius: '6px', margin: '10px 0' }}>
              No proposed placements available in this proposal.
            </div>
          )}

          <div className="changed-actions-bar">
            <button
              type="button"
              className="pop-btn pop-btn-yellow"
              onClick={handleRejectProposal}
              disabled={approving || discarding}
            >
              {discarding ? (
                <>
                  <Loader2 size={15} className="spin" strokeWidth={2.2} />
                  <span>Discarding…</span>
                </>
              ) : (
                <>
                  <Trash2 size={15} strokeWidth={2.2} />
                  <span>Discard proposal</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="pop-btn pop-btn-lime"
              onClick={handleApproveProposal}
              disabled={approving || discarding}
            >
              {approving ? (
                <>
                  <Loader2 size={15} className="spin" strokeWidth={2.2} />
                  <span>Approving…</span>
                </>
              ) : (
                <>
                  <ThumbsUp size={15} strokeWidth={2.2} />
                  <span>Approve plan</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Done for the Day Action / Summary */}
      {!loading && items.length > 0 && (
        <div className="today-close-section">
          {!schedule?.is_closed ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
              <div>
                <span style={{ fontFamily: 'var(--pop-font-heading)', fontSize: '1.15rem' }}>
                  Finished working for the day?
                </span>
                <p style={{ fontSize: '13px', margin: '2px 0 0 0', fontWeight: 600, color: 'var(--pop-black)' }}>
                  Completed ticks lock in and unticked work quietly finds a free slot over the coming days.
                </p>
              </div>
              <button
                type="button"
                className="pop-btn pop-btn-yellow"
                onClick={handleDoneForDay}
                disabled={closingDay}
              >
                {closingDay ? (
                  <>
                    <Loader2 size={15} className="spin" strokeWidth={2.2} />
                    <span>Closing day…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} strokeWidth={2.2} />
                    <span>Done for the day</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
              <div>
                <span className="pop-pill-badge" style={{ background: 'var(--pop-yellow)' }}>
                  Day closed
                </span>
                <p style={{ fontSize: '13px', marginTop: '4px', fontWeight: 600 }}>
                  Recorded on your weekly planner spread. Reopening is allowed until tomorrow morning.
                </p>
              </div>
              {isToday && (
                <button
                  type="button"
                  className="pop-btn pop-btn-yellow"
                  onClick={handleReopen}
                  disabled={closingDay}
                  style={{ fontSize: '13px' }}
                >
                  <RotateCcw size={14} strokeWidth={2.2} />
                  <span>Reopen this day</span>
                </button>
              )}
            </div>
          )}

          {/* Close day summary card */}
          {closeSummary && (
            <div className="changed-result-card" style={{ marginTop: 'var(--space-4)' }}>
              <div className="changed-result-header">
                <div>
                  <h3 style={{ fontFamily: 'var(--pop-font-heading)', margin: 0, fontSize: '1.2rem' }}>
                    {closeSummary.summary}
                  </h3>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--pop-muted)' }}>
                    Nothing failed · Work shifted quietly
                  </span>
                </div>
              </div>

              <div className="changed-list">
                {closeSummary.what_changed.map((line, idx) => (
                  <div key={idx} className="changed-list-item">
                    <CheckCircle2 size={16} className="changed-list-icon" strokeWidth={2.2} />
                    <span>{line}</span>
                  </div>
                ))}
              </div>

              {closeSummary.edgeCases?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {closeSummary.edgeCases.map((ec, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: '#FFF2F0',
                        border: 'var(--pop-border-thin)',
                        padding: '10px 14px',
                        borderRadius: 'var(--pop-radius-sm)',
                        fontSize: '13px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                      }}
                    >
                      <HelpCircle size={15} strokeWidth={2.2} style={{ color: '#D9381E', flexShrink: 0 }} />
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
                  className="pop-btn pop-btn-yellow"
                  onClick={() => setCloseSummary(null)}
                >
                  <RotateCcw size={14} strokeWidth={2.2} />
                  <span>Undo</span>
                </button>
                <button
                  type="button"
                  className="pop-btn pop-btn-lime"
                  onClick={() => setCloseSummary(null)}
                >
                  <span>Keep this plan</span>
                  <ChevronRight size={15} strokeWidth={2.2} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Two buttons "This works" and "Not quite right" */}
      <div className="today-feedback-two-buttons">
        <span className="today-feedback-label">How did today's rhythm feel?</span>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="pop-btn pop-btn-lime"
            onClick={handleThisWorks}
          >
            <Check size={15} strokeWidth={2.2} />
            <span>This works</span>
          </button>
          <button
            type="button"
            className="pop-btn pop-btn-lavender"
            onClick={() => setOffModalOpen(true)}
          >
            <Sparkles size={15} strokeWidth={2.2} />
            <span>Not quite right</span>
          </button>
        </div>
      </div>

      {worksMessage && (
        <div
          style={{
            background: 'var(--pop-yellow)',
            border: 'var(--pop-border)',
            borderRadius: 'var(--pop-radius-sm)',
            padding: '12px 16px',
            boxShadow: 'var(--pop-shadow-sm)',
            fontWeight: 700,
            fontSize: '14px',
          }}
          role="status"
        >
          <span>{worksMessage}</span>
        </div>
      )}

      {/* "Tell Orbit anything" Note Box */}
      <div className="today-note-card">
        <h2 className="today-note-title">Tell Orbit anything</h2>

        <form onSubmit={handleNoteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <textarea
            className="today-note-textarea"
            rows={3}
            placeholder="What worked today, what didn't, or anything Orbit should know about how you work."
            value={noteText}
            onChange={(e) => {
              setNoteText(e.target.value);
              if (noteError) setNoteError('');
            }}
            disabled={noteLoading || !!confirmCard}
          />

          {noteError && (
            <div className="pop-error-banner" style={{ margin: '0', fontSize: '13px', padding: '8px 12px' }}>
              {noteError}
            </div>
          )}

          {!confirmCard && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="pop-btn pop-btn-yellow"
                disabled={noteLoading || !noteText.trim()}
              >
                {noteLoading ? (
                  <>
                    <Loader2 size={15} className="spin" strokeWidth={2.2} />
                    <span>Listening…</span>
                  </>
                ) : (
                  <span>Send to Orbit</span>
                )}
              </button>
            </div>
          )}
        </form>

        {confirmCard && (
          <div className="today-confirm-card" role="region" aria-label="Confirm Note">
            <div className="today-confirm-header">
              <span className="pop-pill-badge" style={{ background: 'var(--pop-white)', textTransform: 'capitalize' }}>
                {confirmCard.kind}
              </span>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>
                Please confirm
              </span>
            </div>
            <p className="today-confirm-sentence">{confirmCard.understood}</p>
            <div className="today-confirm-actions">
              <button
                type="button"
                className="pop-btn pop-btn-yellow"
                onClick={() => setConfirmCard(null)}
                disabled={noteLoading}
              >
                <X size={15} strokeWidth={2.2} />
                <span>Not quite</span>
              </button>
              <button
                type="button"
                className="pop-btn pop-btn-lime"
                onClick={handleConfirmSave}
                disabled={noteLoading}
              >
                {noteLoading ? (
                  <>
                    <Loader2 size={15} className="spin" strokeWidth={2.2} />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Check size={15} strokeWidth={2.2} />
                    <span>Save</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Re-plan Result */}
      {replanResult && (
        <div className="changed-result-card">
          <div className="changed-result-header">
            <div>
              <span className="pop-pill-badge" style={{ background: 'var(--pop-lime)' }}>
                Adapting tomorrow onward
              </span>
              <h3 style={{ fontFamily: 'var(--pop-font-heading)', margin: '6px 0 0 0', fontSize: '1.25rem' }}>
                Here is what changed
              </h3>
            </div>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--pop-muted)' }}>
              Past days & today's ticks preserved
            </span>
          </div>

          <div className="changed-list">
            {replanResult.what_changed.map((change, idx) => (
              <div key={idx} className="changed-list-item">
                <CheckCircle2 size={16} className="changed-list-icon" strokeWidth={2.2} />
                <span>{change}</span>
              </div>
            ))}
          </div>

          <div className="changed-actions-bar">
            <button
              type="button"
              className="pop-btn pop-btn-yellow"
              onClick={() => setReplanResult(null)}
            >
              <RotateCcw size={14} strokeWidth={2.2} />
              <span>Undo</span>
            </button>
            <button
              type="button"
              className="pop-btn pop-btn-lime"
              onClick={() => setReplanResult(null)}
            >
              <span>Keep this plan</span>
              <ChevronRight size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      )}

      {/* Modal 1: "What felt off?" */}
      {offModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="off-modal-title">
          <div className="modal-dialog" ref={offModalRef}>
            <div className="modal-header">
              <h2 id="off-modal-title" className="modal-title">What felt off?</h2>
              <button
                type="button"
                className="pop-btn pop-btn-icon"
                style={{ padding: '6px', minWidth: '32px', minHeight: '32px' }}
                onClick={() => setOffModalOpen(false)}
                aria-label="Close dialog"
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>

            <form onSubmit={handleOffSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                  className="today-note-textarea"
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
                  className="pop-btn pop-btn-yellow"
                  onClick={() => setOffModalOpen(false)}
                  disabled={offSubmitting}
                >
                  Skip
                </button>
                <button
                  type="submit"
                  className="pop-btn pop-btn-lime"
                  disabled={offSubmitting}
                >
                  {offSubmitting ? 'Adapting…' : 'Re-plan tomorrow'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Vague Note Clarification */}
      {vagueModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="vague-modal-title">
          <div className="modal-dialog" ref={vagueModalRef}>
            <div className="modal-header">
              <h2 id="vague-modal-title" className="modal-title">Help Orbit understand</h2>
              <button
                type="button"
                className="pop-btn pop-btn-icon"
                style={{ padding: '6px', minWidth: '32px', minHeight: '32px' }}
                onClick={handleSkipClarification}
                aria-label="Close and save note only"
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>

            <p style={{ fontSize: '13px', fontWeight: 600 }}>
              Orbit wants to make sure upcoming plans reflect what you need:
            </p>

            <form onSubmit={handleSubmitClarification} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                  1. Should we adjust your study load or your break timing?
                </label>
                <input
                  type="text"
                  className="today-changed-quick-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Lighten the study load, or longer pauses"
                  value={clarifyQ1}
                  onChange={(e) => setClarifyQ1(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                  2. Any specific time of day you'd like us to keep clear?
                </label>
                <input
                  type="text"
                  className="today-changed-quick-input"
                  style={{ width: '100%' }}
                  placeholder="e.g. Keep tomorrow evening free"
                  value={clarifyQ2}
                  onChange={(e) => setClarifyQ2(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="pop-btn pop-btn-yellow"
                  onClick={handleSkipClarification}
                >
                  Skip & save note only
                </button>
                <button
                  type="submit"
                  className="pop-btn pop-btn-lime"
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