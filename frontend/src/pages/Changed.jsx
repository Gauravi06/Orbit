import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
  ThumbsUp,
  Trash2,
  Sparkles,
  HelpCircle,
  Clock,
  Compass,
  Zap,
  Calendar,
} from 'lucide-react';
import {
  proposeDisruption,
  approveProposal,
  rejectProposal,
  errText,
} from '../api/client';
import './Changed.css';

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) {
    return isoStr;
  }
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

const SUGGESTIONS = [
  {
    id: 'class-cancelled',
    label: 'Class cancelled',
    sub: 'Free block today',
    text: 'My afternoon class was cancelled today, so I have unexpected free time.',
    colorClass: 'card-pink',
  },
  {
    id: 'feeling-exhausted',
    label: 'Feeling exhausted',
    sub: 'Lighten load & protect rest',
    text: "I am feeling exhausted today. Please lighten my study load and ensure I stop on time.",
    colorClass: 'card-lavender',
  },
  {
    id: 'something-came-up',
    label: 'Something came up',
    sub: 'Need 1-2 hours off',
    text: 'Something came up and I need 2 hours off this afternoon.',
    colorClass: 'card-lime',
  },
  {
    id: 'im-behind',
    label: "I'm behind",
    sub: 'Catch up safely',
    text: "I'm falling behind on my deadlines and need to catch up without burning out.",
    colorClass: 'card-yellow',
  },
];

export function Changed() {
  const [promptText, setPromptText] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState(null);
  const [choiceData, setChoiceData] = useState(null);
  const [clarificationData, setClarificationData] = useState(null);
  const [clarifyAnswer, setClarifyAnswer] = useState('');

  const navigate = useNavigate();
  const chatFlowRef = useRef(null);
  const proposalRef = useRef(null);

  // Auto-scroll when adapting or when proposal / choices arrive
  useEffect(() => {
    if (loading || choiceData || clarificationData) {
      chatFlowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [loading, choiceData, clarificationData]);

  useEffect(() => {
    if (proposal) {
      setTimeout(() => {
        proposalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }, [proposal]);

  const handleDisrupt = async (textToSubmit) => {
    if (loading || approving || discarding) return;
    const text = textToSubmit || promptText;
    if (!text.trim()) return;

    setSubmittedPrompt(text);
    setLoading(true);
    setError('');
    setProposal(null);
    setChoiceData(null);
    setClarificationData(null);

    try {
      const data = await proposeDisruption(text);
      if (data.needs_choice) {
        setChoiceData(data);
      } else if (data.needs_clarification) {
        setClarificationData(data);
      } else {
        setProposal(data);
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = async (option) => {
    if (loading || approving || discarding) return;
    setLoading(true);
    setError('');
    try {
      const activePrompt = submittedPrompt || promptText;
      const data = await proposeDisruption(activePrompt, null, option);
      setProposal(data);
      setChoiceData(null);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitClarification = async (answer) => {
    if (loading || approving || discarding) return;
    setLoading(true);
    setError('');
    try {
      const activePrompt = submittedPrompt || promptText;
      const combined = `${activePrompt} (duration: ${answer})`.trim();
      const data = await proposeDisruption(combined);
      if (data.needs_choice) {
        setChoiceData(data);
        setClarificationData(null);
      } else {
        setProposal(data);
        setClarificationData(null);
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!proposal || approving || discarding || loading) return;
    setApproving(true);
    setError('');
    try {
      await approveProposal(proposal.proposal_id);
      navigate('/today');
    } catch (err) {
      setError(errText(err));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!proposal || approving || discarding || loading) return;
    setDiscarding(true);
    setError('');
    try {
      await rejectProposal(proposal.proposal_id);
      setProposal(null);
      setChoiceData(null);
      setClarificationData(null);
      setSubmittedPrompt('');
      setPromptText('');
    } catch (err) {
      setError(errText(err));
    } finally {
      setDiscarding(false);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setPromptText(suggestion.text);
    handleDisrupt(suggestion.text);
  };

  return (
    <div className="changed-page">
      {/* Decorative sparse student-life doodles around edges */}
      <div className="changed-doodles-layer" aria-hidden="true">
        {/* Star doodle top-right */}
        <svg className="changed-doodle changed-doodle-star-tr" width="54" height="54" viewBox="0 0 54 54" fill="none">
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
        <svg className="changed-doodle changed-doodle-sparkle-l" width="46" height="46" viewBox="0 0 46 46" fill="none">
          <path
            d="M23 4V42M4 23H42M9 9L37 37M9 37L37 9"
            stroke="#FF90E8"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>

        {/* Swirl doodle right */}
        <svg className="changed-doodle changed-doodle-swirl-r" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <path
            d="M6 22C6 13 13 6 22 6C31 6 38 13 38 22C38 31 31 38 22 38C15 38 11 32 11 26C11 20 17 16 23 16"
            stroke="#B8F34A"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </svg>

        {/* Coffee cup doodle bottom-left */}
        <svg className="changed-doodle changed-doodle-coffee-bl" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <path d="M10 16H30V30C30 33 27 36 23 36H17C13 36 10 33 10 30V16Z" fill="#B79CFF" stroke="#111111" strokeWidth="2.5" />
          <path d="M30 20H35C37 20 38 21 38 23V25C38 27 37 28 35 28H30" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M15 10C15 12 17 13 17 15" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
          <path d="M21 8C21 11 23 12 23 15" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      {/* Feature Header: "Plans changed?" */}
      <header className="changed-feature-header">
        <div className="changed-header-content">
          <div className="changed-header-top-row">
            <span className="changed-header-tag">
              <Zap size={13} strokeWidth={2.5} />
              Orbit Adaptive Flow
            </span>
          </div>
          <h1 className="changed-title">Plans changed?</h1>
          <p className="changed-subtitle">
            Life happens mid-week. Tell Orbit what came up in your own words, and we'll quietly reorganise your schedule without guilt.
          </p>
        </div>
      </header>

      {error && (
        <div className="pop-error-banner" role="alert">
          <AlertTriangle size={18} strokeWidth={2.5} />
          <span>{error}</span>
        </div>
      )}

      {/* Prominent Yellow Input Card with White Text Area & Black Submit Button */}
      <div className="changed-input-card">
        <div className="changed-input-header">
          <h2 className="changed-input-title">Tell Orbit what's happening</h2>
          <span className="changed-input-badge">
            <Sparkles size={12} strokeWidth={2.2} />
            Quiet Rebalance
          </span>
        </div>

        {proposal && (
          <button
            type="button"
            className="changed-active-proposal-pill"
            onClick={() => proposalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <Sparkles size={13} strokeWidth={2.5} />
            <span>Active plan proposal ready to review below ↓</span>
          </button>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleDisrupt();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <div className="changed-textarea-wrap">
            <textarea
              className="changed-textarea"
              placeholder="e.g. My afternoon lab got cancelled, or I'm exhausted and need to stop early tonight…"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleDisrupt();
                }
              }}
              disabled={loading}
              rows={3}
            />
          </div>

          <div className="changed-input-actions">
            <span className="changed-submit-hint">
              Press <strong>Enter ↵</strong> or click to adapt
            </span>
            <button
              type="submit"
              className="changed-submit-btn"
              disabled={loading || !promptText.trim()}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="spin" strokeWidth={2.2} />
                  <span>Adapting schedule…</span>
                </>
              ) : (
                <>
                  <span>Reorganise plan</span>
                  <ArrowRight size={16} strokeWidth={2.2} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* "Need a starting point?" with Four Light Pastel Suggestion Cards */}
      <div className="changed-suggestions-section">
        <h3 className="changed-suggestions-title">
          <Compass size={18} strokeWidth={2.5} style={{ color: 'var(--pop-yellow)' }} />
          <span>Need a starting point?</span>
        </h3>

        <div className="changed-suggestions-grid">
          {SUGGESTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`changed-suggestion-card ${item.colorClass}`}
              onClick={() => handleSuggestionClick(item)}
              disabled={loading}
            >
              <div className="changed-suggestion-icon-wrap">
                {item.id === 'class-cancelled' && <Zap size={14} strokeWidth={2.5} />}
                {item.id === 'feeling-exhausted' && <Clock size={14} strokeWidth={2.5} />}
                {item.id === 'something-came-up' && <Sparkles size={14} strokeWidth={2.5} />}
                {item.id === 'im-behind' && <RotateCcw size={14} strokeWidth={2.5} />}
              </div>
              <div className="changed-suggestion-label">{item.label}</div>
              <div className="changed-suggestion-sub">{item.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Inline Conversation & Flow Section */}
      <div ref={chatFlowRef} className="changed-chat-flow">
        {/* User Message in Pink Bubble */}
        {submittedPrompt && (
          <div className="changed-user-bubble">
            <div className="changed-user-bubble-label">You said</div>
            <div>{submittedPrompt}</div>
          </div>
        )}

        {/* Loading / Adapting State */}
        {loading && (
          <div className="changed-busy-banner">
            <Loader2 size={28} className="spin" strokeWidth={2.5} style={{ color: '#111111' }} />
            <div className="changed-busy-title">Adapting your schedule quietly…</div>
            <div className="changed-busy-subtitle">
              Checking deadlines, buffer slots, and preserving your sleep window.
            </div>
          </div>
        )}

        {/* Contextual Options / Choose Your Focus (Pale Lavender Orbit Card) */}
        {choiceData && !proposal && (
          <div className="changed-orbit-card">
            <div className="changed-orbit-header">
              <span className="changed-orbit-badge">
                <Sparkles size={12} strokeWidth={2.2} />
                Orbit Question
              </span>
              <h2 className="changed-orbit-question">
                {choiceData.question || 'How would you like to use this newly available time?'}
              </h2>
            </div>

            <div className="changed-choice-list">
              {(choiceData.options || []).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="changed-choice-btn"
                  onClick={() => handleSelectOption(opt)}
                  disabled={loading}
                >
                  <div>
                    <div className="changed-choice-label">{opt.label}</div>
                    {opt.description && (
                      <div className="changed-choice-desc">{opt.description}</div>
                    )}
                  </div>
                  <ArrowRight size={16} strokeWidth={2.2} style={{ flexShrink: 0, marginLeft: 8 }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Clarification for Delays (Pale Lavender Orbit Card) */}
        {clarificationData && !proposal && (
          <div className="changed-orbit-card">
            <div className="changed-orbit-header">
              <span className="changed-orbit-badge">
                <HelpCircle size={12} strokeWidth={2.2} />
                Clarification Needed
              </span>
              <h2 className="changed-orbit-question">
                {clarificationData.question || 'How long do you expect to be delayed?'}
              </h2>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmitClarification(clarifyAnswer);
              }}
              className="changed-clarify-form"
            >
              <input
                type="text"
                className="changed-clarify-input"
                placeholder="e.g. 1 hour, or until 5 PM"
                value={clarifyAnswer}
                onChange={(e) => setClarifyAnswer(e.target.value)}
                disabled={loading}
                autoFocus
              />
              <button
                type="submit"
                className="changed-submit-btn"
                disabled={loading || !clarifyAnswer.trim()}
              >
                <span>Continue</span>
                <ArrowRight size={15} strokeWidth={2.2} />
              </button>
            </form>
          </div>
        )}

        {/* Schedule Proposal Card with Approve & Reject Actions */}
        {proposal && (
          <div ref={proposalRef} className="changed-proposal-card" role="region" aria-label="Proposed Plan">
            <div className="changed-proposal-header">
              <div className="changed-proposal-headline-wrap">
                <span className="changed-proposal-badge">
                  <CheckCircle2 size={13} strokeWidth={2.5} />
                  Proposed Plan
                </span>
                <h2 className="changed-proposal-title">
                  {proposal.summary || 'Here is what changed'}
                </h2>
              </div>
              <span className="changed-proposal-safe-tag">
                Active schedule unchanged until approved
              </span>
            </div>

            {/* Plain language bullet points */}
            <div className="changed-changes-list">
              {(proposal.what_changed || []).map((change, idx) => (
                <div key={idx} className="changed-changes-item">
                  <CheckCircle2 size={16} className="changed-changes-icon" strokeWidth={2.5} />
                  <span>{change}</span>
                </div>
              ))}
            </div>

            {/* At risk / displaced / unscheduled alerts */}
            {proposal.at_risk?.length > 0 && (
              <div className="changed-risk-list">
                {proposal.at_risk.map((item, idx) => (
                  <div key={item.id || idx} className="changed-risk-item">
                    <AlertTriangle size={16} strokeWidth={2.5} className="changed-risk-icon" />
                    <span>
                      <strong>{item.title}</strong>: {item.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Proposed Schedule Slots Timeline */}
            {proposal.days && proposal.days.length > 0 && (
              <div className="changed-schedule-preview">
                <div className="changed-schedule-preview-header">
                  <Calendar size={15} strokeWidth={2.5} />
                  <span>Proposed Schedule Placements</span>
                </div>
                <div className="changed-schedule-days">
                  {proposal.days.map((day, dIdx) => {
                    const activeSlots = (day.items || []).filter((it) => it.status !== 'displaced');
                    return (
                      <div key={dIdx} className="changed-day-card">
                        <div className="changed-day-date-badge">{day.date}</div>
                        <div className="changed-day-slots">
                          {activeSlots.map((slot, sIdx) => {
                            const isFocus = slot.kind === 'deep' || slot.kind === 'task';
                            const isBuffer = slot.kind === 'break' || slot.kind === 'decompression';
                            const isOpen = slot.kind === 'open';
                            return (
                              <div
                                key={slot.id || sIdx}
                                className={`changed-slot-pill ${slot.is_fixed ? 'is-fixed' : isFocus ? 'is-focus' : isBuffer ? 'is-buffer' : isOpen ? 'is-open' : 'is-default'}`}
                              >
                                <span className="changed-slot-time">
                                  {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                                </span>
                                <span className="changed-slot-name">{slot.title}</span>
                                {slot.is_fixed && <span className="changed-slot-badge">Fixed</span>}
                                {isFocus && <span className="changed-slot-badge badge-focus">Focus</span>}
                                {isBuffer && <span className="changed-slot-badge badge-buffer">Buffer</span>}
                                {isOpen && <span className="changed-slot-badge badge-open">Open</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions: Reject or Approve */}
            <div className="changed-proposal-actions">
              <button
                type="button"
                className="changed-btn-reject"
                onClick={handleReject}
                disabled={loading || approving || discarding}
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
                className="changed-btn-approve"
                onClick={handleApprove}
                disabled={loading || approving || discarding}
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
      </div>
    </div>
  );
}

export default Changed;
