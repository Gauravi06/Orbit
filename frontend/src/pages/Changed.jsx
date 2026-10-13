import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import {
  proposeDisruption,
  approveProposal,
  rejectProposal,
  errText,
} from '../api/client';
import './Changed.css';

export function Changed() {
  const [promptText, setPromptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState(null);
  const [choiceData, setChoiceData] = useState(null);
  const [clarificationData, setClarificationData] = useState(null);
  const [clarifyAnswer, setClarifyAnswer] = useState('');

  const navigate = useNavigate();

  const handleDisrupt = async (textToSubmit) => {
    if (loading || approving || discarding) return;
    const text = textToSubmit || promptText;
    if (!text.trim()) return;

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
      const data = await proposeDisruption(promptText, null, option);
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
      const combined = `${promptText} (duration: ${answer})`.trim();
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
      setPromptText('');
    } catch (err) {
      setError(errText(err));
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <div className="changed-page">
      {/* Header */}
      <div className="changed-header">
        <h1 className="changed-title">Something Changed?</h1>
        <p className="changed-subtitle">
          Life happens mid-week. Tell Orbit what came up in your own words, and it will
          quietly reorganise your workload without guilt or overdue badges.
        </p>
      </div>

      {error && (
        <div className="form-error" style={{ fontSize: 'var(--text-sm)' }}>
          {error}
        </div>
      )}

      {/* Main Disruption Form */}
      <div className="changed-card">
        <h2 className="changed-card-title">Describe what happened</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleDisrupt();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
        >
          <textarea
            className="input changed-textarea"
            placeholder="What changed?"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            disabled={loading}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !promptText.trim()}
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="spin" strokeWidth={1.5} />
                  <span>Rearranging your day…</span>
                </>
              ) : (
                <>
                  <span>Reorganise Plan</span>
                  <ArrowRight size={15} strokeWidth={1.5} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Rearranging Loading State */}
      {loading && (
        <div className="changed-busy-banner">
          <Loader2 size={24} className="spin" strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 'bold' }}>
            Adapting your schedule quietly…
          </div>
          <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
            Checking deadlines, buffer slots, and preserving your sleep window.
          </div>
        </div>
      )}

      {/* Contextual Options for Broad Productivity Request */}
      {choiceData && !proposal && (
        <div className="changed-result-card" style={{ marginTop: 'var(--space-4)' }}>
          <div className="changed-result-header">
            <div>
              <span className="tag tag-accent" style={{ marginBottom: 'var(--space-1)' }}>
                Choose Your Focus
              </span>
              <h2 style={{ fontFamily: 'var(--font-display)', margin: 0, fontSize: 'var(--text-md)' }}>
                {choiceData.question || 'How would you like to use this newly available time?'}
              </h2>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            {(choiceData.options || []).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="btn btn-secondary"
                style={{
                  textAlign: 'left',
                  justifyContent: 'space-between',
                  padding: 'var(--space-3)',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                }}
                onClick={() => handleSelectOption(opt)}
                disabled={loading}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{opt.label}</div>
                  {opt.description && (
                    <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: '2px' }}>
                      {opt.description}
                    </div>
                  )}
                </div>
                <ArrowRight size={14} strokeWidth={1.5} style={{ opacity: 0.6 }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Clarification for Unknown Delays */}
      {clarificationData && !proposal && (
        <div className="changed-result-card" style={{ marginTop: 'var(--space-4)' }}>
          <div className="changed-result-header">
            <div>
              <span className="tag tag-accent" style={{ marginBottom: 'var(--space-1)' }}>
                Clarification Needed
              </span>
              <h2 style={{ fontFamily: 'var(--font-display)', margin: 0, fontSize: 'var(--text-md)' }}>
                {clarificationData.question || 'How long do you expect to be delayed?'}
              </h2>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmitClarification(clarifyAnswer);
            }}
            style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}
          >
            <input
              type="text"
              className="input"
              placeholder="e.g. 1 hour, or until 5 PM"
              value={clarifyAnswer}
              onChange={(e) => setClarifyAnswer(e.target.value)}
              disabled={loading}
              style={{ flex: 1 }}
              autoFocus
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !clarifyAnswer.trim()}
            >
              <span>Continue</span>
              <ArrowRight size={14} strokeWidth={1.5} />
            </button>
          </form>
        </div>
      )}

      {/* Disruption Results: Proposed Changes */}
      {proposal && (
        <div className="changed-result-card">
          <div className="changed-result-header">
            <div>
              <span className="tag tag-accent" style={{ marginBottom: 'var(--space-1)' }}>
                Proposed Plan
              </span>
              <h2 style={{ fontFamily: 'var(--font-display)', margin: 0, fontSize: 'var(--text-md)' }}>
                {proposal.summary || 'Here is what changed'}
              </h2>
            </div>
            <span className="text-muted" style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
              Active schedule unchanged until approved
            </span>
          </div>

          {/* Plain language bullet points */}
          <div className="changed-list">
            {(proposal.what_changed || []).map((change, idx) => (
              <div key={idx} className="changed-list-item">
                <CheckCircle2 size={16} className="changed-list-icon" strokeWidth={1.5} />
                <span>{change}</span>
              </div>
            ))}
          </div>

          {/* At risk / displaced / unscheduled alerts */}
          {proposal.at_risk?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {proposal.at_risk.map((item, idx) => (
                <div
                  key={item.id || idx}
                  style={{
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--accent)' }} />
                  <span>
                    <strong>{item.title}</strong>: {item.reason}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Actions: Discard or Approve */}
          <div className="changed-actions-bar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleReject}
              disabled={loading || approving || discarding}
            >
              {discarding ? (
                <>
                  <Loader2 size={14} className="spin" strokeWidth={1.5} />
                  <span>Discarding…</span>
                </>
              ) : (
                <>
                  <Trash2 size={14} strokeWidth={1.5} />
                  <span>Discard proposal</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={loading || approving || discarding}
            >
              {approving ? (
                <>
                  <Loader2 size={14} className="spin" strokeWidth={1.5} />
                  <span>Approving…</span>
                </>
              ) : (
                <>
                  <ThumbsUp size={14} strokeWidth={1.5} />
                  <span>Approve plan</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Changed;
